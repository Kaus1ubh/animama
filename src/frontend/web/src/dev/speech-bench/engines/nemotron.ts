import * as ort from "onnxruntime-web";
import { JsPreprocessor } from "parakeet.js";

import type { BenchConfig } from "../bench-protocol";
import type { StreamingEngine } from "../bench-runner";

import {
  fetchJson,
  fetchText,
  parseTokenTable,
  requireModelBase,
} from "./model-files";
import { PRE_ENCODE_FRAMES, detokenize, greedyRnnt, melChunk } from "./rnnt";

/**
 * Model description written beside the files by `speech_eval.py models`: the
 * sherpa-onnx export's ONNX metadata, or the same values for the onnx-community
 * INT4 export, plus which graph contract the files follow.
 */
type NemotronMetadata = {
  contract: "sherpa" | "onnx-community";
  window_size: string;
  chunk_shift: string;
  cache_last_channel_dim1: string;
  cache_last_channel_dim2: string;
  cache_last_channel_dim3: string;
  cache_last_time_dim1: string;
  cache_last_time_dim2: string;
  cache_last_time_dim3: string;
  pred_rnn_layers: string;
  pred_hidden: string;
  prompt_dictionary: string;
};

const MEL_BINS = 128;
const HOP = 160;
/** NeMo centres frames: frame t covers samples [160t − 256, 160t + 256). */
const HALF_WINDOW = 256;
/** Samples needed before the first `frames` mel frames are complete. */
const samplesForFrames = (frames: number) => (frames - 1) * HOP + HALF_WINDOW;
const ENCODER_DIM = 1024;

/**
 * App locales to Nemotron language prompts; Cantonese is not supported. The
 * model's `zh-TW` prompt produced only noise on Mandarin speech, so `zh-Hant`
 * uses `zh-CN` and the page converts the script, as for SenseVoice.
 */
const LOCALE_PROMPTS: Record<string, string> = {
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-CN",
};

/**
 * File names and tensor layouts of the two exports. Inputs and outputs are
 * addressed by position, which both exports share: encoder (audio, length,
 * channel cache, time cache, cache length, prompt) → (outputs, lengths,
 * channel cache, time cache, cache length).
 */
const CONTRACTS = {
  sherpa: {
    encoder: "encoder.int8.onnx",
    decoder: "decoder.int8.onnx",
    joiner: "joiner.int8.onnx",
    tokens: "tokens.txt",
    externalData: false,
    timeMajor: false,
    int32Targets: true,
  },
  "onnx-community": {
    encoder: "encoder.onnx",
    decoder: "decoder.onnx",
    joiner: "joint.onnx",
    tokens: "vocab.txt",
    externalData: true,
    timeMajor: true,
    int32Targets: false,
  },
} as const;

type Contract = (typeof CONTRACTS)[keyof typeof CONTRACTS];

function createSession(
  base: string,
  file: string,
  contract: Contract,
  provider: "wasm" | "webgpu",
): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(`${base}/${file}`, {
    executionProviders: [provider],
    ...(contract.externalData
      ? {
          externalData: [
            { path: `${file}.data`, data: `${base}/${file}.data` },
          ],
        }
      : {}),
  });
}

const zeros = (dims: number[]) =>
  new ort.Tensor(
    "float32",
    new Float32Array(dims.reduce((a, b) => a * b, 1)),
    dims,
  );

const int64 = (value: number) =>
  new ort.Tensor("int64", BigInt64Array.of(BigInt(value)), [1]);

type Prediction = { output: Float32Array; h: ort.Tensor; c: ort.Tensor };

/**
 * Nemotron 3.5 ASR streaming (cache-aware FastConformer-RNNT). Audio arrives in
 * `chunk_shift`-frame chunks; each encoder call sees the chunk plus 9 frames of
 * look-back and carries its attention and convolution caches forward, and the
 * greedy transducer keeps its prediction state across chunks. On WebGPU only
 * the encoder runs on the GPU: the LSTM prediction network and joint stay on
 * WASM, where all their operators exist.
 */
export async function loadNemotronEngine(
  config: BenchConfig,
): Promise<StreamingEngine> {
  const base = requireModelBase(config);
  const metadata = await fetchJson<NemotronMetadata>(`${base}/metadata.json`);
  const contract: Contract = CONTRACTS[metadata.contract];
  const tokenText = await fetchText(`${base}/${contract.tokens}`);
  const tokens =
    metadata.contract === "sherpa"
      ? parseTokenTable(tokenText)
      : tokenText.replace(/\n$/, "").split("\n");
  const blank = tokens.length - 1;
  const prompts = JSON.parse(metadata.prompt_dictionary) as Record<
    string,
    number
  >;
  const shift = Number(metadata.chunk_shift);
  const width = Number(metadata.window_size);
  const channelCacheDims = [
    1,
    Number(metadata.cache_last_channel_dim1),
    Number(metadata.cache_last_channel_dim2),
    Number(metadata.cache_last_channel_dim3),
  ];
  const timeCacheDims = [
    1,
    Number(metadata.cache_last_time_dim1),
    Number(metadata.cache_last_time_dim2),
    Number(metadata.cache_last_time_dim3),
  ];
  const hidden = Number(metadata.pred_hidden);
  const stateDims = [Number(metadata.pred_rnn_layers), 1, hidden];

  // Created one after another: ONNX Runtime initializes its WASM module once,
  // and parallel first sessions with different providers race to do so.
  const encoder = await createSession(
    base,
    contract.encoder,
    contract,
    config.backend,
  );
  const decoder = await createSession(base, contract.decoder, contract, "wasm");
  const joiner = await createSession(base, contract.joiner, contract, "wasm");
  const preprocessor = new JsPreprocessor({ nMels: MEL_BINS });

  async function predict(
    token: number,
    h: ort.Tensor,
    c: ort.Tensor,
  ): Promise<Prediction> {
    const target = contract.int32Targets
      ? new ort.Tensor("int32", Int32Array.of(token), [1, 1])
      : new ort.Tensor("int64", BigInt64Array.of(BigInt(token)), [1, 1]);
    const inputs = decoder.inputNames;
    const feeds: Record<string, ort.Tensor> = contract.int32Targets
      ? {
          [inputs[0]]: target,
          [inputs[1]]: new ort.Tensor("int32", Int32Array.of(1), [1]),
          [inputs[2]]: h,
          [inputs[3]]: c,
        }
      : { [inputs[0]]: target, [inputs[1]]: h, [inputs[2]]: c };
    const out = await decoder.run(feeds);
    const names = decoder.outputNames;
    // sherpa's decoder also returns the prediction lengths before the states.
    const stateOffset = contract.int32Targets ? 2 : 1;
    return {
      output: (out[names[0]].data as Float32Array).slice(0, hidden),
      h: out[names[stateOffset]],
      c: out[names[stateOffset + 1]],
    };
  }

  async function joint(
    encoderVector: Float32Array,
    decoderVector: Float32Array,
  ): Promise<Float32Array> {
    const encoderDims = contract.timeMajor
      ? [1, 1, ENCODER_DIM]
      : [1, ENCODER_DIM, 1];
    const decoderDims = contract.timeMajor ? [1, 1, hidden] : [1, hidden, 1];
    const out = await joiner.run({
      [joiner.inputNames[0]]: new ort.Tensor(
        "float32",
        encoderVector,
        encoderDims,
      ),
      [joiner.inputNames[1]]: new ort.Tensor(
        "float32",
        decoderVector,
        decoderDims,
      ),
    });
    return out[joiner.outputNames[0]].data as Float32Array;
  }

  return {
    kind: "stream",
    start: (locale) => {
      const prompt = prompts[LOCALE_PROMPTS[locale] ?? ""];
      if (prompt === undefined) {
        throw new Error(`Nemotron has no language for ${locale}`);
      }
      let audio = new Float32Array(0);
      // Frames received since the last encode, joined only when a chunk is due.
      let pending: Float32Array[] = [];
      let pendingSamples = 0;
      let text = "";
      const mel: Float32Array[] = [];
      let chunksDone = 0;
      let channelCache: ort.Tensor = zeros(channelCacheDims);
      let timeCache: ort.Tensor = zeros(timeCacheDims);
      let cacheLength: ort.Tensor = int64(0);
      let prediction: Prediction | null = null;
      const emitted: number[] = [];

      /** Append newly complete mel frames (every sample of their window present). */
      function updateMel(): void {
        const complete =
          audio.length < HALF_WINDOW
            ? 0
            : Math.floor((audio.length - HALF_WINDOW) / HOP) + 1;
        if (complete <= mel.length) return;
        const { rawMel, nFrames } = preprocessor.computeRawMel(
          audio,
          mel.length,
        );
        for (let frame = mel.length; frame < complete; frame += 1) {
          mel.push(
            Float32Array.from(
              { length: MEL_BINS },
              (_, bin) => rawMel[bin * nFrames + frame],
            ),
          );
        }
      }

      async function runChunk(): Promise<void> {
        const start = chunksDone * shift - PRE_ENCODE_FRAMES;
        const valid = Math.min(shift, mel.length - chunksDone * shift);
        const out = await encoder.run({
          [encoder.inputNames[0]]: new ort.Tensor(
            "float32",
            melChunk(mel, MEL_BINS, start, width, contract.timeMajor),
            contract.timeMajor ? [1, width, MEL_BINS] : [1, MEL_BINS, width],
          ),
          [encoder.inputNames[1]]: int64(PRE_ENCODE_FRAMES + valid),
          [encoder.inputNames[2]]: channelCache,
          [encoder.inputNames[3]]: timeCache,
          [encoder.inputNames[4]]: cacheLength,
          [encoder.inputNames[5]]: int64(prompt),
        });
        const names = encoder.outputNames;
        const encoded = out[names[0]];
        const frames = Number((out[names[1]].data as BigInt64Array)[0]);
        channelCache = out[names[2]];
        timeCache = out[names[3]];
        cacheLength = out[names[4]];
        chunksDone += 1;

        const data = encoded.data as Float32Array;
        const steps = contract.timeMajor ? encoded.dims[1] : encoded.dims[2];
        const vector = (frame: number) =>
          contract.timeMajor
            ? data.subarray(frame * ENCODER_DIM, (frame + 1) * ENCODER_DIM)
            : Float32Array.from(
                { length: ENCODER_DIM },
                (_, d) => data[d * steps + frame],
              );
        let current: Prediction =
          prediction ??
          (await predict(blank, zeros(stateDims), zeros(stateDims)));
        const tokens = await greedyRnnt(Math.min(frames, steps), blank, {
          joint: (frame) => joint(vector(frame), current.output),
          emit: async (token) => {
            current = await predict(token, current.h, current.c);
          },
        });
        prediction = current;
        emitted.push(...tokens);
      }

      /** Append the pending frames and `padding` samples of silence. */
      function takePending(padding = 0): void {
        const next = new Float32Array(audio.length + pendingSamples + padding);
        next.set(audio);
        let offset = audio.length;
        for (const frame of pending) {
          next.set(frame, offset);
          offset += frame.length;
        }
        audio = next;
        pending = [];
        pendingSamples = 0;
      }

      /** Encode every chunk whose mel frames are complete. */
      async function drain(): Promise<string> {
        updateMel();
        while ((chunksDone + 1) * shift <= mel.length) await runChunk();
        text = detokenize(emitted, tokens);
        return text;
      }

      return {
        push: async (frame) => {
          pending.push(frame);
          pendingSamples += frame.length;
          const nextChunkReady =
            audio.length + pendingSamples >=
            samplesForFrames((chunksDone + 1) * shift);
          if (!nextChunkReady) return text;
          takePending();
          return drain();
        },
        finish: () => {
          // Trailing silence flushes the last chunk and any token the
          // look-ahead was still holding back.
          takePending(shift * HOP + HALF_WINDOW);
          return drain();
        },
      };
    },
  };
}
