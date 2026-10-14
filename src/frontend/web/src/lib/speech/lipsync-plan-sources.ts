/**
 * Lip-sync plan sources compared in the Anima debug panel's Lip-sync view.
 *
 * A source turns one captured run's inputs into a vowel viseme segment, the
 * same shape the avatar plays. "Estimated (today)" wraps gruut's planner, and
 * "Aligned (new)" replans the captured audio and text in the lip-sync worker,
 * as replies are planned now. Other sources can register themselves; the view
 * draws and replays every source without changes.
 */

import { buildVisemeAssetsFromRaw } from "@/lib/avatar/viseme-worker-client";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import { startLipSyncRun } from "@/lib/lipsync/lipsync-worker-client";
import { mergePlanFrames, plannedSegment } from "@/lib/lipsync/planned-segment";
import type { TimedChar } from "./provider-speech-timing";
import type { SpeechTimingEvidence } from "./speech-timing-evidence";

/** What a captured run offers a planner. */
export type LipSyncPlanInputs = {
  runId: string;
  /** The gruut phonemes and text the estimated planner receives for the run. */
  phonemizedText: string[][] | null;
  tokenizedText: string | null;
  fps: number;
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

export const ESTIMATED_LIPSYNC_PLAN_SOURCE_ID = "estimated";

/**
 * Today's planner, given the run's final inputs and the played length, as it
 * plans when the length is known before playback. During realtime speech the
 * avatar plays a provisional plan first and rescales the rest once the length
 * is known, so the live mouth can differ slightly from this curve.
 */
const estimatedPlanSource: LipSyncPlanSource = {
  id: ESTIMATED_LIPSYNC_PLAN_SOURCE_ID,
  label: "Estimated (today)",
  build: async (inputs) => {
    if (!Array.isArray(inputs.phonemizedText)) return null;
    const result = await buildVisemeAssetsFromRaw({
      runId: `lipsync-debug-${inputs.runId}`,
      mode: "actual_prestart",
      phonemizedText: inputs.phonemizedText,
      tokenizedText: inputs.tokenizedText,
      fps: inputs.fps,
      targetDurationSec: inputs.audioDurationSec,
    });
    return result.segment ? { segment: result.segment } : null;
  },
};

export const ALIGNED_LIPSYNC_PLAN_SOURCE_ID = "aligned";
let alignedBuilds = 0;

/**
 * Today's planner on the captured audio, text and timing, fed in as captured.
 * Audio arrives all at once rather than as played, so plans can differ
 * slightly from the live run's.
 */
const alignedPlanSource: LipSyncPlanSource = {
  id: ALIGNED_LIPSYNC_PLAN_SOURCE_ID,
  label: "Aligned (new)",
  build: (inputs) => {
    // Some environments (tests) have no workers to plan in.
    if (typeof Worker === "undefined") return Promise.resolve(null);
    const runId = `lipsync-debug-${inputs.runId}-${(alignedBuilds += 1)}`;
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
      if (inputs.timing.length) run.addTiming(inputs.timing);
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
  },
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

/** gruut's estimate, the aligned planner, then registered sources in order. */
export function lipSyncPlanSources(): readonly LipSyncPlanSource[] {
  return [estimatedPlanSource, alignedPlanSource, ...registeredSources];
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
