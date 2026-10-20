/**
 * Timing logic for the development speech benchmark, independent of any
 * engine or clock so it can be tested deterministically.
 *
 * Two kinds of engine are compared on the same basis:
 * - window engines (Parakeet, SenseVoice) transcribe a finished speech window,
 *   and may show interim text by re-decoding the growing window through the
 *   app's preview controller;
 * - streaming engines (Nemotron) consume fixed-size chunks as audio arrives and
 *   return a partial transcript after each one.
 *
 * Every engine call goes through one serial queue, as in the app's worker, so a
 * preview in flight delays the final decode that follows it.
 */

import {
  createParakeetPreviewController,
  DEFAULT_PARAKEET_PREVIEW_CONFIG,
} from "@/lib/speech/client-parakeet/preview-controller";

import type { BenchClipResult, BenchMode } from "./bench-protocol";

export const BENCH_SAMPLE_RATE = 16000;
/** MicVAD delivers 512-sample frames at 16 kHz. */
const BENCH_FRAME_SAMPLES = 512;

export type WindowEngine = {
  kind: "window";
  transcribe: (audio: Float32Array, language: string) => Promise<string>;
};

type StreamingSession = {
  /** Feed one chunk; resolves to the partial transcript so far. */
  push: (chunk: Float32Array) => Promise<string>;
  /** Flush buffered audio; resolves to the final transcript. */
  finish: () => Promise<string>;
};

export type StreamingEngine = {
  kind: "stream";
  chunkSamples: number;
  start: (language: string) => StreamingSession;
};

export type BenchEngine = WindowEngine | StreamingEngine;

export type BenchClock = {
  now: () => number;
  sleepUntil: (timeMs: number) => Promise<void>;
};

export type ClipTiming = Omit<BenchClipResult, "set" | "id">;

type RunOptions = { mode: BenchMode; interim: boolean; clock: BenchClock };

/**
 * Final-text delay after the last audio sample for a serial streaming engine.
 * Chunk `i` arrives once its last sample has been spoken (the final chunk may
 * be partial, ending at `audioMs`) and starts when it has arrived and the
 * previous chunk has finished; the end-of-stream flush follows the last chunk.
 */
export function streamTailLatencyMs(
  chunkProcessingMs: readonly number[],
  chunkMs: number,
  audioMs: number,
  flushMs = 0,
): number {
  let finished = 0;
  chunkProcessingMs.forEach((processing, index) => {
    const arrival = Math.min((index + 1) * chunkMs, audioMs);
    finished = Math.max(arrival, finished) + processing;
  });
  return Math.max(finished, audioMs) + flushMs - audioMs;
}

function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function chunks(audio: Float32Array, size: number): Float32Array[] {
  const result: Float32Array[] = [];
  for (let start = 0; start < audio.length; start += size) {
    result.push(audio.subarray(start, start + size));
  }
  return result;
}

const samplesToMs = (samples: number) => (samples / BENCH_SAMPLE_RATE) * 1000;

async function windowThroughput(
  engine: WindowEngine,
  audio: Float32Array,
  language: string,
  clock: BenchClock,
): Promise<ClipTiming> {
  const startedAt = clock.now();
  const text = await engine.transcribe(audio, language);
  const processingMs = clock.now() - startedAt;
  return {
    audioSeconds: audio.length / BENCH_SAMPLE_RATE,
    text,
    finalLatencyMs: processingMs,
    processingMs,
    firstInterimMs: null,
    interimCount: 0,
    interimStops: 0,
  };
}

async function windowPaced(
  engine: WindowEngine,
  audio: Float32Array,
  language: string,
  { interim, clock }: RunOptions,
): Promise<ClipTiming> {
  const queue = serialQueue();
  const startedAt = clock.now();
  let firstInterimMs: number | null = null;
  let interimCount = 0;
  let interimStops = 0;
  const previews = interim
    ? createParakeetPreviewController({
        config: {
          ...DEFAULT_PARAKEET_PREVIEW_CONFIG,
          sampleRateHz: BENCH_SAMPLE_RATE,
          preSpeechPadMs: 0,
        },
        now: clock.now,
        transcribe: ({ audio: windowAudio }) =>
          queue(async () => {
            const decodeStartedAt = clock.now();
            const text = await engine.transcribe(windowAudio, language);
            return { text, decodeMs: clock.now() - decodeStartedAt };
          }),
        onPreview: ({ text }) => {
          if (!text.trim()) return;
          interimCount += 1;
          firstInterimMs ??= clock.now() - startedAt;
        },
        onEvent: (event) => {
          if (event.type !== "preview_ready") interimStops += 1;
        },
      })
    : null;
  previews?.startWindow({ turnId: "bench", windowId: "clip" });

  const frames = chunks(audio, BENCH_FRAME_SAMPLES);
  let delivered = 0;
  for (const frame of frames) {
    delivered += frame.length;
    await clock.sleepUntil(startedAt + samplesToMs(delivered));
    previews?.pushFrame(frame);
  }
  // As in streaming, the final delay counts from when the last sample was
  // spoken, including any time a preview still holds the worker.
  const audioEndedAt = startedAt + samplesToMs(delivered);
  previews?.endWindow("clip");

  let processingMs = 0;
  const text = await queue(async () => {
    const decodeStartedAt = clock.now();
    const finalText = await engine.transcribe(audio, language);
    processingMs = clock.now() - decodeStartedAt;
    return finalText;
  });
  return {
    audioSeconds: audio.length / BENCH_SAMPLE_RATE,
    text,
    finalLatencyMs: clock.now() - audioEndedAt,
    processingMs,
    firstInterimMs,
    interimCount,
    interimStops,
  };
}

async function stream(
  engine: StreamingEngine,
  audio: Float32Array,
  language: string,
  { mode, clock }: RunOptions,
): Promise<ClipTiming> {
  const session = engine.start(language);
  const startedAt = clock.now();
  const chunkProcessingMs: number[] = [];
  let firstInterimMs: number | null = null;
  let interimCount = 0;
  let delivered = 0;
  let lastArrivalAt = startedAt;

  for (const chunk of chunks(audio, engine.chunkSamples)) {
    delivered += chunk.length;
    if (mode === "paced") {
      lastArrivalAt = startedAt + samplesToMs(delivered);
      await clock.sleepUntil(lastArrivalAt);
    }
    const pushStartedAt = clock.now();
    const partial = await session.push(chunk);
    chunkProcessingMs.push(clock.now() - pushStartedAt);
    if (mode === "paced" && partial.trim()) {
      interimCount += 1;
      firstInterimMs ??= clock.now() - startedAt;
    }
  }
  const finishStartedAt = clock.now();
  const text = await session.finish();
  const flushMs = clock.now() - finishStartedAt;

  const processingMs =
    chunkProcessingMs.reduce((sum, ms) => sum + ms, 0) + flushMs;
  return {
    audioSeconds: audio.length / BENCH_SAMPLE_RATE,
    text,
    finalLatencyMs:
      mode === "paced"
        ? clock.now() - lastArrivalAt
        : streamTailLatencyMs(
            chunkProcessingMs,
            samplesToMs(engine.chunkSamples),
            samplesToMs(audio.length),
            flushMs,
          ),
    processingMs,
    firstInterimMs,
    interimCount,
    interimStops: 0,
  };
}

/** Transcribe one clip and time it according to the engine kind and mode. */
export function runClip(
  engine: BenchEngine,
  audio: Float32Array,
  language: string,
  options: RunOptions,
): Promise<ClipTiming> {
  if (engine.kind === "stream") return stream(engine, audio, language, options);
  return options.mode === "paced"
    ? windowPaced(engine, audio, language, options)
    : windowThroughput(engine, audio, language, options.clock);
}
