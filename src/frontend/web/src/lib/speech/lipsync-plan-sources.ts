/**
 * Lip-sync plan sources compared in the Anima debug panel's Lip-sync view.
 *
 * A source turns one captured run's inputs into a vowel viseme segment, the
 * same shape the avatar plays. The built-in sources replan the captured audio
 * and text in the lip-sync worker, as replies are planned now, with each
 * combination of evidence: text and audio alone, then with the provider's
 * character timing. Other sources can register themselves; the view draws and
 * replays every source without changes.
 */

import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import { startLipSyncRun } from "@/lib/lipsync/lipsync-worker-client";
import { mergePlanFrames, plannedSegment } from "@/lib/lipsync/planned-segment";
import type { TimedChar } from "./provider-speech-timing";
import type { SpeechTimingEvidence } from "./speech-timing-evidence";

/** What a captured run offers a planner. */
export type LipSyncPlanInputs = {
  runId: string;
  /** The played audio's length. */
  audioDurationSec: number;
  /** Provider character timing on the run clock, and the evidence built from it. */
  timing: readonly TimedChar[];
  evidence: SpeechTimingEvidence;
  /** The played audio, 16-bit. */
  audio: { chunks: readonly Int16Array[]; sampleRate: number };
  /** The text sent to the voice, when known. */
  text: string | null;
  /** Speech parts (Gemini) by the sample their audio starts at. */
  parts: ReadonlyArray<{ sample: number; text: string }>;
};

export type LipSyncPlanResult = {
  segment: VowelVisemeLipSyncSegment;
  /** Planning CPU per second of audio, in milliseconds, where measured. */
  cpuMsPerAudioSec?: number;
};

export type LipSyncPlanSource = {
  id: string;
  label: string;
  /** Build the run's plan, or `null` when this source cannot plan it. */
  build: (inputs: LipSyncPlanInputs) => Promise<LipSyncPlanResult | null>;
};

let workerBuilds = 0;

/**
 * Today's planner on the captured audio and text, and the timing when asked,
 * fed in as captured. Audio arrives all at once rather than as played, so
 * plans can differ slightly from the live run's.
 */
function planInWorker(
  inputs: LipSyncPlanInputs,
  withTiming: boolean,
): Promise<LipSyncPlanResult | null> {
  // Some environments (tests) have no workers to plan in.
  if (typeof Worker === "undefined") return Promise.resolve(null);
  const runId = `lipsync-debug-${inputs.runId}-${(workerBuilds += 1)}`;
  return new Promise((resolve, reject) => {
    let track: Float32Array | null = null;
    const run = startLipSyncRun({
      runId,
      sampleRate: inputs.audio.sampleRate,
      onResponse: (response) => {
        if (response.type === "error") {
          run.cancel();
          reject(new Error(response.message));
          return;
        }
        track = mergePlanFrames(track, response);
        if (!response.complete) return;
        run.cancel();
        resolve({
          segment: plannedSegment(runId, track),
          cpuMsPerAudioSec:
            response.audioSec > 0
              ? response.cpuMs / response.audioSec
              : undefined,
        });
      },
    });
    if (!inputs.parts.length) run.setText(inputs.text ?? "", true);
    if (withTiming) run.addTiming(inputs.timing);
    let sample = 0;
    let part = 0;
    for (const chunk of inputs.audio.chunks) {
      for (; part < inputs.parts.length; part += 1) {
        if (inputs.parts[part]!.sample > sample) break;
        run.startPart(inputs.parts[part]!.text);
      }
      run.pushPcm(chunk);
      sample += chunk.length;
    }
    run.endAudio();
  });
}

export const TEXT_AUDIO_LIPSYNC_PLAN_SOURCE_ID = "text-audio";

/** The plan from the text and the audio alone, as Gemini and Pocket replies get. */
const textAudioPlanSource: LipSyncPlanSource = {
  id: TEXT_AUDIO_LIPSYNC_PLAN_SOURCE_ID,
  label: "Text and audio",
  build: (inputs) => planInWorker(inputs, false),
};

export const TIMED_LIPSYNC_PLAN_SOURCE_ID = "timed";

/** The plan with the provider's character timing too, when the run has it. */
const timedPlanSource: LipSyncPlanSource = {
  id: TIMED_LIPSYNC_PLAN_SOURCE_ID,
  label: "With provider timing",
  build: (inputs) =>
    inputs.timing.length ? planInWorker(inputs, true) : Promise.resolve(null),
};

const registeredSources: LipSyncPlanSource[] = [];

/**
 * Add a plan source to the debug view, replacing one with the same id. Returns
 * a function that removes it.
 */
export function registerLipSyncPlanSource(
  source: LipSyncPlanSource,
): () => void {
  const existing = registeredSources.findIndex(
    (candidate) => candidate.id === source.id,
  );
  if (existing >= 0) registeredSources.splice(existing, 1, source);
  else registeredSources.push(source);
  return () => {
    const index = registeredSources.indexOf(source);
    if (index >= 0) registeredSources.splice(index, 1);
  };
}

/** The built-in evidence combinations, then registered sources in order. */
export function lipSyncPlanSources(): readonly LipSyncPlanSource[] {
  return [textAudioPlanSource, timedPlanSource, ...registeredSources];
}

// Approximate jaw opening of each Vowel5 shape (A, E, I, O, U), for display only.
const OPENNESS_WEIGHTS = [1, 0.6, 0.35, 0.8, 0.45] as const;

/** A segment's approximate mouth opening (0–1) at each frame. */
export function mouthOpennessCurve(
  segment: VowelVisemeLipSyncSegment,
): Array<{ timeSec: number; openness: number }> {
  const curve: Array<{ timeSec: number; openness: number }> = [];
  for (const frame of segment.frames) {
    const { time_sec: timeSec, values } = frame;
    if (typeof timeSec !== "number" || !Array.isArray(values)) continue;
    const openness = OPENNESS_WEIGHTS.reduce(
      (sum, weight, index) =>
        sum + weight * (typeof values[index] === "number" ? values[index] : 0),
      0,
    );
    curve.push({ timeSec, openness: Math.min(1, Math.max(0, openness)) });
  }
  return curve;
}
