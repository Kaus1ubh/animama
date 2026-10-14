/**
 * A tap on the PCM each speech runtime plays, for lip-sync planning and the
 * debug panel's Lip-sync view. Runtimes emit every chunk they hand to playback,
 * in order, with silence for any gap they schedule. With no listener installed,
 * emitting costs one size check per chunk.
 *
 * Runtimes that play through the PCM worklet also report where playback
 * resumed after an underrun, so lip-sync can follow the silence it inserted.
 * Browser speech, whose audio cannot be captured, reports its utterances.
 */

export type SpeechPcmProvider = "elevenlabs" | "gemini" | "pocket";

export type SpeechPcmTapEvent = {
  runId: string;
  provider: SpeechPcmProvider;
  sampleRate: number;
  /**
   * The chunk's samples, as 16-bit integers or floats in [-1, 1]. The runtime
   * keeps using the array, so a listener copies what it keeps.
   */
  pcm: Int16Array | Float32Array;
  /**
   * When the chunk starts a new speech part, the part's text. Gemini speaks a
   * reply in parts, and lip-sync plans each against its own audio.
   */
  partText?: string;
};

export type SpeechPcmListener = (event: SpeechPcmTapEvent) => void;

const listeners = new Set<SpeechPcmListener>();

/** Listen to every run's PCM; returns a function that stops listening. */
export function addSpeechPcmListener(listener: SpeechPcmListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hand a played chunk to the listeners. */
export function emitSpeechPcm(event: SpeechPcmTapEvent): void {
  if (!listeners.size || !event.pcm.length) return;
  for (const listener of listeners) listener(event);
}

/**
 * Speech played without capturable audio (browser speech): when each
 * utterance starts and ends, and where the voice says each word starts. Times
 * are `performanceClock` seconds.
 */
export type SpeechUtteranceEvent =
  | { runId: string; type: "start"; text: string; atSec: number }
  | { runId: string; type: "boundary"; charIndex: number; atSec: number }
  | { runId: string; type: "end"; atSec: number };

export type SpeechUtteranceListener = (event: SpeechUtteranceEvent) => void;

const utteranceListeners = new Set<SpeechUtteranceListener>();

/** Listen to every run's utterances; returns a function that stops listening. */
export function addSpeechUtteranceListener(
  listener: SpeechUtteranceListener,
): () => void {
  utteranceListeners.add(listener);
  return () => {
    utteranceListeners.delete(listener);
  };
}

export function emitSpeechUtterance(event: SpeechUtteranceEvent): void {
  for (const listener of utteranceListeners) listener(event);
}

/** Playback of a run resumed after an underrun: run second `runSec` played at context time `contextSec`. */
export type SpeechPlaybackResumedEvent = {
  runId: string;
  runSec: number;
  contextSec: number;
};

export type SpeechPlaybackListener = (
  event: SpeechPlaybackResumedEvent,
) => void;

const playbackListeners = new Set<SpeechPlaybackListener>();

/** Listen for playback resuming after underruns; returns a function that stops listening. */
export function addSpeechPlaybackListener(
  listener: SpeechPlaybackListener,
): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function emitSpeechPlaybackResumed(
  event: SpeechPlaybackResumedEvent,
): void {
  for (const listener of playbackListeners) listener(event);
}

/** The `playbackResumed` detail the PCM player emits, as a run-clock anchor. */
export function playbackResumedAnchor(
  detail: unknown,
): { runSec: number; contextSec: number } | null {
  const value = (detail ?? {}) as {
    playedSamples?: unknown;
    audioTime?: unknown;
    sampleRate?: unknown;
  };
  if (
    typeof value.playedSamples !== "number" ||
    typeof value.audioTime !== "number" ||
    typeof value.sampleRate !== "number" ||
    value.sampleRate <= 0
  )
    return null;
  return {
    runSec: value.playedSamples / value.sampleRate,
    contextSec: value.audioTime,
  };
}
