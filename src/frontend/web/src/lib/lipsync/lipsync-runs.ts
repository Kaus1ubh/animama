/**
 * Routes each speaking reply to the lip-sync worker: the run's text (from TTS
 * playback), its audio (from the PCM tap) and its provider timing, until the
 * audio ends or the run is cleared. Plans go to the avatar lip-sync bridge.
 *
 * A run starts planning with its first audio chunk, which carries the provider
 * and sample rate; text that arrives earlier waits for it. When a provider
 * changes mid-run (ElevenLabs falling back to Pocket), planning restarts. A
 * chunk that starts a speech part (Gemini) carries the part's text.
 *
 * Browser speech has no audio to capture: its run is an estimate from each
 * utterance's text, placed by when the voice says the utterance and its words
 * start, on the run clock from the first utterance's start.
 */

import { createLogger } from "@/lib/logger";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import {
  addSpeechPcmListener,
  addSpeechUtteranceListener,
  type SpeechPcmProvider,
  type SpeechPcmTapEvent,
  type SpeechUtteranceEvent,
} from "@/lib/speech/speech-pcm-tap";
import {
  startLipSyncEstimateRun,
  startLipSyncRun,
  type LipSyncEstimateRunHandle,
  type LipSyncRunHandle,
} from "./lipsync-worker-client";
import type { LipSyncWorkerResponse } from "./worker-protocol";

const logger = createLogger("LipSyncRuns");

type RunEntry = {
  provider: SpeechPcmProvider | null;
  handle: LipSyncRunHandle | null;
  /** Browser speech: the estimate run, and its clock's zero. */
  estimate: { handle: LipSyncEstimateRunHandle; startSec: number } | null;
  text: string;
  textFinal: boolean;
  /** Whether the run's audio names its parts' text (Gemini). */
  inParts: boolean;
  timing: TimedChar[];
  audioEnded: boolean;
};

export type LipSyncRunsSink = {
  /** A worker response for a run. */
  onResponse: (runId: string, response: LipSyncWorkerResponse) => void;
};

const entries = new Map<string, RunEntry>();
let sink: LipSyncRunsSink | null = null;
let stopListening: Array<() => void> | null = null;

function entryFor(runId: string): RunEntry {
  let entry = entries.get(runId);
  if (!entry) {
    entry = {
      provider: null,
      handle: null,
      estimate: null,
      text: "",
      textFinal: false,
      inParts: false,
      timing: [],
      audioEnded: false,
    };
    entries.set(runId, entry);
  }
  return entry;
}

const forward = (runId: string) => (response: LipSyncWorkerResponse) => {
  if (response.type === "error") {
    logger.warn("Plan", "Lip-sync planning failed for a run", {
      runId,
      message: response.message,
    });
  }
  sink?.onResponse(runId, response);
};

function start(runId: string, entry: RunEntry, event: SpeechPcmTapEvent) {
  entry.handle?.cancel();
  entry.estimate?.handle.cancel();
  entry.estimate = null;
  entry.provider = event.provider;
  entry.inParts = false;
  entry.audioEnded = false;
  entry.handle = startLipSyncRun({
    runId,
    sampleRate: event.sampleRate,
    onResponse: forward(runId),
  });
  if (entry.text) entry.handle.setText(entry.text, entry.textFinal);
  if (entry.timing.length) entry.handle.addTiming(entry.timing);
}

function onPcm(event: SpeechPcmTapEvent) {
  if (!sink) return;
  const entry = entryFor(event.runId);
  if (!entry.handle || entry.provider !== event.provider) {
    start(event.runId, entry, event);
  }
  if (event.partText) {
    entry.inParts = true;
    entry.handle!.startPart(event.partText);
  }
  entry.handle!.pushPcm(event.pcm);
}

function onUtterance(event: SpeechUtteranceEvent) {
  if (!sink) return;
  const entry = entryFor(event.runId);
  if (event.type === "start" && !entry.estimate) {
    entry.handle?.cancel();
    entry.handle = null;
    entry.provider = null;
    entry.estimate = {
      handle: startLipSyncEstimateRun({
        runId: event.runId,
        onResponse: forward(event.runId),
      }),
      startSec: event.atSec,
    };
  }
  const estimate = entry.estimate;
  if (!estimate) return;
  const sec = event.atSec - estimate.startSec;
  if (event.type === "start") estimate.handle.startUtterance(event.text, sec);
  else if (event.type === "boundary")
    estimate.handle.addBoundary(event.charIndex, sec);
  else estimate.handle.endUtterance(sec);
}

/** Start routing runs to the worker and their plans to `target`. */
export function connectLipSyncRuns(target: LipSyncRunsSink): () => void {
  sink = target;
  stopListening ??= [
    addSpeechPcmListener(onPcm),
    addSpeechUtteranceListener(onUtterance),
  ];
  return () => {
    if (sink === target) {
      sink = null;
      for (const stop of stopListening ?? []) stop();
      stopListening = null;
      cancelAllLipSyncRuns();
    }
  };
}

/** The text sent to the voice so far; `final` once the reply's text is complete. */
export function setLipSyncRunText(
  runId: string,
  text: string,
  final: boolean,
): void {
  const entry = entryFor(runId);
  entry.text = text;
  entry.textFinal = final;
  // A run in parts has its text from its parts.
  if (!entry.inParts) entry.handle?.setText(text, final);
}

export function addLipSyncRunTiming(
  runId: string,
  chars: readonly TimedChar[],
): void {
  if (!chars.length) return;
  const entry = entryFor(runId);
  entry.timing.push(...chars);
  entry.handle?.addTiming(chars);
}

/** All of the run's audio has arrived. */
export function endLipSyncRunAudio(runId: string): void {
  const entry = entries.get(runId);
  if (!entry || entry.audioEnded) return;
  entry.audioEnded = true;
  entry.handle?.endAudio();
}

function cancelEntry(entry: RunEntry): void {
  entry.handle?.cancel();
  entry.estimate?.handle.cancel();
}

export function cancelLipSyncRun(runId: string): void {
  const entry = entries.get(runId);
  if (entry) cancelEntry(entry);
  entries.delete(runId);
}

export function cancelAllLipSyncRuns(): void {
  for (const entry of entries.values()) cancelEntry(entry);
  entries.clear();
}
