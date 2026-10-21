import * as ort from "onnxruntime-web";

import type { BenchConfig } from "../bench-protocol";
import type { WindowEngine } from "../bench-runner";

import { applyCmvn, kaldiFbank, stackLowFrameRate } from "./kaldi-fbank";
import {
  fetchJson,
  fetchText,
  parseTokenTable,
  requireModelBase,
} from "./model-files";

/** ONNX metadata of the sherpa-onnx SenseVoice export, saved beside the model. */
type SenseVoiceMetadata = Record<string, string>;

/** CTC blank (`<unk>` in the sherpa token table). */
const BLANK = 0;
const TAG = /^<\|.*\|>$/;

/** App locales to SenseVoice language prompts. */
const LOCALE_KEYS: Record<string, string> = {
  en: "lang_en",
  ja: "lang_ja",
  ko: "lang_ko",
  "zh-Hans": "lang_zh",
  "zh-Hant": "lang_zh",
  yue: "lang_yue",
};

const floats = (value: string) => Float32Array.from(value.split(","), Number);

/**
 * Greedy CTC over `[frames × vocab]` logits: best token per frame, collapse
 * repeats, drop blanks, then drop SenseVoice's `<|…|>` language, emotion, event
 * and normalization tags wherever they appear.
 */
export function decodeSenseVoiceLogits(
  logits: Float32Array,
  frames: number,
  vocab: number,
  tokens: readonly string[],
): string {
  const pieces: string[] = [];
  let previous = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * vocab;
    let best = 0;
    for (let id = 1; id < vocab; id += 1) {
      if (logits[offset + id] > logits[offset + best]) best = id;
    }
    if (best !== previous && best !== BLANK && !TAG.test(tokens[best] ?? "")) {
      pieces.push(tokens[best] ?? "");
    }
    previous = best;
  }
  return pieces.join("").replace(/▁/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * SenseVoice-Small (sherpa-onnx export): Kaldi fbank, 7×6 frame stacking and
 * CMVN in JS, one non-autoregressive pass, greedy CTC. WASM runs the INT8
 * graph; WebGPU runs the FP32 graph, whose operators all exist in ORT's JSEP
 * kernels (the INT8 graph's dynamic-quantization operators do not).
 */
export async function loadSenseVoiceEngine(
  config: BenchConfig,
): Promise<WindowEngine> {
  const base = requireModelBase(config);
  const [metadata, tokenText] = await Promise.all([
    fetchJson<SenseVoiceMetadata>(`${base}/metadata.json`),
    fetchText(`${base}/tokens.txt`),
  ]);
  const tokens = parseTokenTable(tokenText);
  const negMean = floats(metadata.neg_mean);
  const invStddev = floats(metadata.inv_stddev);
  const window = Number(metadata.lfr_window_size);
  const shift = Number(metadata.lfr_window_shift);
  const withItn = Number(metadata.with_itn);
  const session = await ort.InferenceSession.create(
    `${base}/${config.backend === "webgpu" ? "model.onnx" : "model.int8.onnx"}`,
    { executionProviders: [config.backend] },
  );

  return {
    kind: "window",
    transcribe: async (audio, locale) => {
      const languageKey = LOCALE_KEYS[locale];
      if (!languageKey)
        throw new Error(`SenseVoice has no language for ${locale}`);
      const frames = kaldiFbank(audio);
      if (frames.length === 0) return "";
      const features = applyCmvn(
        stackLowFrameRate(frames, window, shift),
        negMean,
        invStddev,
      );
      const featureDims = negMean.length;
      const steps = features.length / featureDims;
      const { logits } = await session.run({
        x: new ort.Tensor("float32", features, [1, steps, featureDims]),
        x_length: new ort.Tensor("int32", Int32Array.of(steps), [1]),
        language: new ort.Tensor(
          "int32",
          Int32Array.of(Number(metadata[languageKey])),
          [1],
        ),
        text_norm: new ort.Tensor("int32", Int32Array.of(withItn), [1]),
      });
      const [, outputFrames, vocab] = logits.dims;
      const text = decodeSenseVoiceLogits(
        logits.data as Float32Array,
        outputFrames,
        vocab,
        tokens,
      );
      logits.dispose();
      return text;
    },
  };
}
