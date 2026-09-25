/**
 * Live (interim) Parakeet transcript previews for an open MicVAD speech window.
 *
 * Parakeet TDT is an offline, full-context model, so previews re-decode the
 * growing window buffer rather than stitching independent chunks. Previews are
 * display-only: the single full-window decode after `onSpeechEnd` remains the
 * only source of final text, Smart Turn input and submission.
 *
 * Decode cost grows with buffered audio and a preview in flight delays the final
 * decode that follows it on the same worker, so the controller:
 * - keeps at most one preview in flight;
 * - spaces previews by `max(minIntervalMs, intervalDecodeMultiplier × last decode)`;
 * - stops previewing a window once the predicted decode time exceeds
 *   `maxPreviewDecodeMs`, bounding the extra latency a final can inherit.
 *   A window's first preview, when sent on time, is not predicted, which
 *   re-measures the decode rate after a slow spell; a budget of 0 disables
 *   previews;
 * - drops results for windows that already ended or were reset.
 *
 * The controller is driven by MicVAD frames and an injected clock, so it has no
 * timers and can be tested deterministically.
 */

export type ParakeetPreviewConfig = {
  sampleRateHz: number;
  /** Audio retained from before a window opens, matching MicVAD's pre-speech pad. */
  preSpeechPadMs: number;
  /** Window audio (after the pad) required before the first preview. */
  firstPreviewMs: number;
  minIntervalMs: number;
  intervalDecodeMultiplier: number;
  /**
   * Largest predicted preview decode allowed; beyond it the window stops
   * previewing. `0` disables previews entirely.
   */
  maxPreviewDecodeMs: number;
  /** Previews decode at most this much of the most recent audio. */
  maxPreviewAudioMs: number;
};

export const DEFAULT_PARAKEET_PREVIEW_CONFIG: Omit<
  ParakeetPreviewConfig,
  "sampleRateHz" | "preSpeechPadMs"
> = {
  firstPreviewMs: 600,
  minIntervalMs: 600,
  intervalDecodeMultiplier: 1.5,
  maxPreviewDecodeMs: 800,
  maxPreviewAudioMs: 20_000,
};

export type ParakeetPreviewRequest = {
  turnId: string;
  windowId: string;
  audio: Float32Array;
};

export type ParakeetPreview = {
  turnId: string;
  windowId: string;
  text: string;
};

export type ParakeetPreviewEvent =
  | {
      type: "preview_ready";
      windowId: string;
      audioMs: number;
      decodeMs: number;
      textLength: number;
    }
  | {
      type: "budget_exceeded";
      windowId: string;
      audioMs: number;
      /** `null` when no decode rate has been measured yet. */
      predictedDecodeMs: number | null;
    }
  | { type: "preview_failed"; windowId: string; message: string };

type ParakeetPreviewControllerDeps = {
  config: ParakeetPreviewConfig;
  now: () => number;
  transcribe: (
    request: ParakeetPreviewRequest,
  ) => Promise<{ text: string; decodeMs: number }>;
  onPreview: (preview: ParakeetPreview) => void;
  onEvent?: (event: ParakeetPreviewEvent) => void;
  /** Checked before each dispatch; `false` skips decoding without ending the window. */
  shouldPreview?: (turnId: string) => boolean;
};

export type ParakeetPreviewController = {
  /** Feed every MicVAD frame, inside or outside a speech window. */
  pushFrame: (frame: Float32Array) => void;
  startWindow: (args: { turnId: string; windowId: string }) => void;
  /** Stop previewing a window; its in-flight result is discarded. */
  endWindow: (windowId: string | null) => void;
  /** Forget all windows and discard every in-flight result. */
  reset: () => void;
};

type OpenWindow = {
  turnId: string;
  windowId: string;
  frames: Float32Array[];
  sampleCount: number;
  speechSamples: number;
  lastDispatchAtMs: number | null;
  stopped: boolean;
};

function concatenateTail(
  frames: Float32Array[],
  totalSamples: number,
  maxSamples: number,
): Float32Array {
  const length = Math.min(totalSamples, maxSamples);
  const output = new Float32Array(length);
  let writeEnd = length;
  for (let index = frames.length - 1; index >= 0 && writeEnd > 0; index -= 1) {
    const frame = frames[index];
    const take = Math.min(frame.length, writeEnd);
    output.set(frame.subarray(frame.length - take), writeEnd - take);
    writeEnd -= take;
  }
  return output;
}

export function createParakeetPreviewController({
  config,
  now,
  transcribe,
  onPreview,
  onEvent,
  shouldPreview,
}: ParakeetPreviewControllerDeps): ParakeetPreviewController {
  const samplesPerMs = config.sampleRateHz / 1000;
  const padSamples = Math.round(config.preSpeechPadMs * samplesPerMs);
  const maxPreviewSamples = Math.round(config.maxPreviewAudioMs * samplesPerMs);
  const firstPreviewExemptMs =
    config.preSpeechPadMs + config.firstPreviewMs + config.minIntervalMs;

  let padFrames: Float32Array[] = [];
  let padSampleCount = 0;
  let window: OpenWindow | null = null;
  let generation = 0;
  let inFlight = false;
  let lastDecodeMs: number | null = null;
  /** Measured decode milliseconds per millisecond of audio. */
  let decodeRate: number | null = null;

  const retainPadFrame = (frame: Float32Array) => {
    padFrames.push(frame);
    padSampleCount += frame.length;
    while (
      padFrames.length > 0 &&
      padSampleCount - padFrames[0].length >= padSamples
    ) {
      padSampleCount -= padFrames.shift()!.length;
    }
    if (padSamples === 0) {
      padFrames = [];
      padSampleCount = 0;
    }
  };

  const dispatch = (active: OpenWindow) => {
    const audio = concatenateTail(
      active.frames,
      active.sampleCount,
      maxPreviewSamples,
    );
    const audioMs = audio.length / samplesPerMs;
    // A window's first preview normally runs unchecked, so a past slow decode
    // (for example a cold first inference) cannot silence every later window.
    // A first preview held back by `shouldPreview` until the window grew long
    // is still predicted, keeping the latency a final can inherit bounded.
    const isOnTimeFirstPreview =
      active.lastDispatchAtMs === null && audioMs <= firstPreviewExemptMs;
    if (!isOnTimeFirstPreview) {
      // Without a measured rate a late, long first preview cannot be bounded.
      const predictedDecodeMs =
        decodeRate === null ? null : decodeRate * audioMs;
      if (
        predictedDecodeMs === null ||
        predictedDecodeMs > config.maxPreviewDecodeMs
      ) {
        active.stopped = true;
        onEvent?.({
          type: "budget_exceeded",
          windowId: active.windowId,
          audioMs,
          predictedDecodeMs,
        });
        return;
      }
    }

    const requestGeneration = generation;
    active.lastDispatchAtMs = now();
    inFlight = true;
    transcribe({ turnId: active.turnId, windowId: active.windowId, audio })
      .then(({ text, decodeMs }) => {
        if (requestGeneration !== generation) return;
        inFlight = false;
        lastDecodeMs = decodeMs;
        decodeRate = decodeMs / Math.max(audioMs, 1);
        if (window !== active || active.stopped) return;
        const trimmed = text.trim();
        onEvent?.({
          type: "preview_ready",
          windowId: active.windowId,
          audioMs,
          decodeMs,
          textLength: trimmed.length,
        });
        if (trimmed) {
          onPreview({
            turnId: active.turnId,
            windowId: active.windowId,
            text: trimmed,
          });
        }
      })
      .catch((error: unknown) => {
        if (requestGeneration !== generation) return;
        inFlight = false;
        active.stopped = true;
        onEvent?.({
          type: "preview_failed",
          windowId: active.windowId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const maybeDispatch = () => {
    const active = window;
    if (!active || active.stopped || inFlight) return;
    if (shouldPreview && !shouldPreview(active.turnId)) return;
    const speechMs = active.speechSamples / samplesPerMs;
    if (active.lastDispatchAtMs === null) {
      if (speechMs >= config.firstPreviewMs) dispatch(active);
      return;
    }
    const intervalMs = Math.max(
      config.minIntervalMs,
      config.intervalDecodeMultiplier * (lastDecodeMs ?? 0),
    );
    if (now() - active.lastDispatchAtMs >= intervalMs) dispatch(active);
  };

  return {
    pushFrame(frame) {
      const copy = new Float32Array(frame);
      if (!window || window.stopped) {
        retainPadFrame(copy);
        return;
      }
      window.frames.push(copy);
      window.sampleCount += copy.length;
      window.speechSamples += copy.length;
      // Previews never decode more than the capped tail, so drop older frames.
      while (
        window.frames.length > 1 &&
        window.sampleCount - window.frames[0].length >= maxPreviewSamples
      ) {
        window.sampleCount -= window.frames.shift()!.length;
      }
      maybeDispatch();
    },
    startWindow({ turnId, windowId }) {
      if (config.maxPreviewDecodeMs <= 0) return;
      window = {
        turnId,
        windowId,
        frames: padFrames,
        sampleCount: padSampleCount,
        speechSamples: 0,
        lastDispatchAtMs: null,
        stopped: false,
      };
      padFrames = [];
      padSampleCount = 0;
    },
    endWindow(windowId) {
      if (window && (windowId === null || window.windowId === windowId)) {
        window.stopped = true;
        window = null;
      }
    },
    reset() {
      generation += 1;
      inFlight = false;
      window = null;
      padFrames = [];
      padSampleCount = 0;
    },
  };
}
