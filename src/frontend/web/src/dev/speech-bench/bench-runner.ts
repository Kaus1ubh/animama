/**
 * Timing logic for the development speech benchmark, independent of any
 * engine or clock so it can be tested deterministically.
 *
 * Engines (Parakeet, SenseVoice) transcribe a finished speech window and may
 * show interim text by re-decoding the growing window through the app's preview
 * controller, fed MicVAD's 512-sample frames.
 *
 * Every engine call goes through one serial queue, as in the app's worker, so a
 * preview in flight delays the final decode that follows it.
 */

import {
  createSpeechPreviewController,
  DEFAULT_SPEECH_PREVIEW_CONFIG,
} from "@/lib/speech/offline-stt/preview-controller";

import type { BenchClipResult, BenchMode } from "./bench-protocol";

export const BENCH_SAMPLE_RATE = 16000;
/** MicVAD delivers 512-sample frames at 16 kHz. */
const BENCH_FRAME_SAMPLES = 512;

/** An engine transcribes a speech window for a test set: a preview or the final. */
export type BenchEngine = {
  transcribe: (
    audio: Float32Array,
    set: string,
    kind: "preview" | "final",
  ) => Promise<string>;
};

export type BenchClock = {
  now: () => number;
  sleepUntil: (timeMs: number) => Promise<void>;
};

export type ClipTiming = Omit<BenchClipResult, "set" | "id">;

type RunOptions = { mode: BenchMode; interim: boolean; clock: BenchClock };

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
  engine: BenchEngine,
  audio: Float32Array,
  locale: string,
  clock: BenchClock,
): Promise<ClipTiming> {
  const startedAt = clock.now();
  const text = await engine.transcribe(audio, locale, "final");
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
  engine: BenchEngine,
  audio: Float32Array,
  locale: string,
  { interim, clock }: RunOptions,
): Promise<ClipTiming> {
  const queue = serialQueue();
  const startedAt = clock.now();
  let firstInterimMs: number | null = null;
  let interimCount = 0;
  let interimStops = 0;
  const previews = interim
    ? createSpeechPreviewController({
        config: {
          ...DEFAULT_SPEECH_PREVIEW_CONFIG,
          sampleRateHz: BENCH_SAMPLE_RATE,
          preSpeechPadMs: 0,
        },
        now: clock.now,
        transcribe: ({ audio: windowAudio }) =>
          queue(async () => {
            const decodeStartedAt = clock.now();
            const text = await engine.transcribe(
              windowAudio,
              locale,
              "preview",
            );
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
  // The final delay counts from when the last sample was spoken, including
  // any time a preview still holds the worker.
  const audioEndedAt = startedAt + samplesToMs(delivered);
  previews?.endWindow("clip");

  let processingMs = 0;
  const text = await queue(async () => {
    const decodeStartedAt = clock.now();
    const finalText = await engine.transcribe(audio, locale, "final");
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

/** Transcribe one clip and time it according to the mode. */
export function runClip(
  engine: BenchEngine,
  audio: Float32Array,
  locale: string,
  options: RunOptions,
): Promise<ClipTiming> {
  return options.mode === "paced"
    ? windowPaced(engine, audio, locale, options)
    : windowThroughput(engine, audio, locale, options.clock);
}
