/**
 * SenseVoice-Small (sherpa-onnx export): Kaldi fbank, 7×6 frame stacking and
 * CMVN in JS, one non-autoregressive pass, greedy CTC. WASM runs the CPU set's
 * INT8 graph; WebGPU runs the GPU set's FP32 graph, whose operators all exist
 * in ONNX Runtime's JSEP kernels (the INT8 graph's quantized operators do not).
 *
 * The SenseVoice worker runs this module; it configures ONNX Runtime first.
 */
import * as ort from "onnxruntime-web";

import { closeUnspacedGaps } from "@/lib/speech/speech-text";
import { applyCmvn, kaldiFbank, stackLowFrameRate } from "./kaldi-fbank";
import { toTraditional } from "./script";

/** SenseVoice's files by role: the graph (CPU or GPU set) and the CPU set's tables. */
export type SenseVoiceModelUrls = {
  modelUrl: string;
  tokensUrl: string;
  metadataUrl: string;
};

/** The conversation languages SenseVoice serves (English only in the benchmark). */
export type SenseVoiceLanguage = "en" | "ja" | "ko" | "zh-Hans" | "zh-Hant";

/**
 * Language prompts from `metadata.json`. `zh-Hant` lets the model detect
 * Mandarin or Cantonese, which both use Traditional script there.
 */
const LANGUAGE_PROMPTS: Record<SenseVoiceLanguage, string> = {
  en: "lang_en",
  ja: "lang_ja",
  ko: "lang_ko",
  "zh-Hans": "lang_zh",
  "zh-Hant": "lang_auto",
};

/** CTC blank (`<unk>` in the sherpa token table). */
const BLANK = 0;
const TAG = /^<\|.*\|>$/;
/** Text that says something: a letter or digit in any script. */
const WORDED = /[\p{L}\p{N}]/u;
/**
 * The least mean probability of a final window's word tokens for it to count
 * as speech. Prompted with a language, SenseVoice writes one word for silence
 * or noise (こ, 그, 我, "The"), but at 0.07–0.22; speech scores 0.86 or more
 * per clip on the test set, and one-word replies 0.58 or more (issue #509).
 * Previews skip it: a word still being spoken scores low too, and the final
 * replaces every preview.
 */
export const MIN_WORD_CONFIDENCE = 0.4;

/** Softmax probability of `id` in one frame of logits. */
function probability(
  logits: Float32Array,
  offset: number,
  vocab: number,
  id: number,
) {
  const top = logits[offset + id];
  let sum = 0;
  for (let k = 0; k < vocab; k += 1) sum += Math.exp(logits[offset + k] - top);
  return 1 / sum;
}

export function isSenseVoiceLanguage(
  language: string,
): language is SenseVoiceLanguage {
  return Object.hasOwn(LANGUAGE_PROMPTS, language);
}

/**
 * sherpa-onnx `tokens.txt`: one `piece id` pair per line. Split on the last
 * space, since that is the only field separator.
 */
export function parseTokenTable(text: string): string[] {
  const tokens: string[] = [];
  for (const line of text.split("\n")) {
    const separator = line.lastIndexOf(" ");
    if (separator <= 0) continue;
    tokens[Number(line.slice(separator + 1))] = line.slice(0, separator);
  }
  return tokens;
}

/**
 * Greedy CTC over `[frames × vocab]` logits: best token per frame, collapse
 * repeats, drop blanks, then drop SenseVoice's `<|…|>` language, emotion, event
 * and normalization tags wherever they appear. Word-start marks (`▁`) become
 * spaces, except beside Chinese or Japanese text, which is written unspaced.
 * A window without words, or whose words average below `minWordConfidence`
 * (silence or noise forced into a word), yields no text.
 */
export function decodeSenseVoiceLogits(
  logits: Float32Array,
  frames: number,
  vocab: number,
  tokens: readonly string[],
  minWordConfidence = MIN_WORD_CONFIDENCE,
): string {
  const pieces: string[] = [];
  let wordConfidence = 0;
  let words = 0;
  let previous = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * vocab;
    let best = 0;
    for (let id = 1; id < vocab; id += 1) {
      if (logits[offset + id] > logits[offset + best]) best = id;
    }
    const piece = tokens[best] ?? "";
    if (best !== previous && best !== BLANK && !TAG.test(piece)) {
      pieces.push(piece);
      if (WORDED.test(piece)) {
        if (minWordConfidence > 0)
          wordConfidence += probability(logits, offset, vocab, best);
        words += 1;
      }
    }
    previous = best;
  }
  if (words === 0 || wordConfidence / words < minWordConfidence) return "";
  return closeUnspacedGaps(
    pieces.join("").replace(/▁/g, " ").replace(/\s+/g, " ").trim(),
  );
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  return response;
}

const floats = (value: string) => Float32Array.from(value.split(","), Number);

export type SenseVoiceModel = {
  /**
   * Text in the language's script; empty for a window without speech. Only a
   * final window must pass the word-confidence gate.
   */
  transcribe: (
    audio: Float32Array,
    language: SenseVoiceLanguage,
    kind?: "final" | "preview",
  ) => Promise<string>;
  release: () => Promise<void>;
};

export async function loadSenseVoiceModel(
  urls: SenseVoiceModelUrls,
  backend: "wasm" | "webgpu",
): Promise<SenseVoiceModel> {
  const [metadata, tokenText] = await Promise.all([
    fetchOk(urls.metadataUrl).then(
      (response) => response.json() as Promise<Record<string, string>>,
    ),
    fetchOk(urls.tokensUrl).then((response) => response.text()),
  ]);
  const tokens = parseTokenTable(tokenText);
  const negMean = floats(metadata.neg_mean);
  const invStddev = floats(metadata.inv_stddev);
  const window = Number(metadata.lfr_window_size);
  const shift = Number(metadata.lfr_window_shift);
  const withItn = Number(metadata.with_itn);
  const session = await ort.InferenceSession.create(urls.modelUrl, {
    executionProviders: [backend],
  });

  return {
    transcribe: async (audio, language, kind = "final") => {
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
          Int32Array.of(Number(metadata[LANGUAGE_PROMPTS[language]])),
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
        kind === "final" ? MIN_WORD_CONFIDENCE : 0,
      );
      logits.dispose();
      // SenseVoice writes Chinese in Simplified script.
      return language === "zh-Hant" ? await toTraditional(text) : text;
    },
    release: () => session.release(),
  };
}
