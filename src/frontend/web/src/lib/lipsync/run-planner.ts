/**
 * Plans one reply's lip-sync as its text and audio arrive, for the lip-sync
 * worker. It extracts audio features incrementally, keeps a progressive
 * planner, and re-plans every quarter second of new audio (and once more when
 * both the audio and the text are complete). Each update carries only the
 * frames that changed since the previous one.
 *
 * Text comes one of two ways. Most providers send the reply's text as it grows
 * (`setText`). Gemini speaks a reply in parts and names each part's text with
 * its first audio (`startPart`); once a run has parts, the growing text is
 * ignored, and the text is complete when the audio is.
 *
 * If planning throws, the run's mouth follows its audio alone from then on
 * (`planner_failed`), and speech plays on.
 */

import { createSpeechFeatureExtractor } from "@/lib/lipsync/audio/features";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import { createLipSyncPlanner, type LipSyncPlan } from "./planner";
import type { SpeechGestureTiming } from "./render/beats";
import type { LipSyncEvent, LipSyncTrack } from "./track";

/** New audio that triggers a fresh plan. */
const PLAN_STEP_SEC = 0.25;

export type RunPlanUpdate = {
  /** Increases with every update for the run. */
  seq: number;
  /** The first 60 FPS frame that differs from the previous update. */
  fromFrame: number;
  /** Frames `fromFrame` to `frameCount`, five weights each (A, E, I, O, U). */
  frames: Float32Array;
  frameCount: number;
  events: LipSyncEvent[];
  gestures: SpeechGestureTiming;
  /** Whether all of the run's audio and text were planned. */
  complete: boolean;
  /** Why the mouth follows the audio alone, in part or (after an error) all. */
  fallback: LipSyncPlan["fallback"] | "planner_failed";
  /** The planning error, on the update that first reports `planner_failed`. */
  error?: string;
  /** Seconds of run audio planned so far. */
  audioSec: number;
  /** CPU so far, in milliseconds: audio analysis and planning. */
  cpuMs: number;
};

export type LipSyncRunPlannerOptions = {
  sampleRate: number;
  hanLanguage?: "ja" | "zh";
  onUpdate: (update: RunPlanUpdate) => void;
};

export type LipSyncRunPlanner = {
  /** The text sent to the voice so far; `final` once no more will follow. */
  setText: (text: string, final: boolean) => void;
  /** A speech part starts with the next audio, speaking `text`. */
  startPart: (text: string) => void;
  pushPcm: (pcm: Float32Array | Int16Array) => void;
  /** Provider character timing, in arrival order. */
  addTiming: (chars: readonly TimedChar[]) => void;
  /** All of the run's audio has arrived. */
  endAudio: () => void;
};

type RunUpdateContent = Omit<
  RunPlanUpdate,
  "seq" | "fromFrame" | "frames" | "frameCount" | "events"
> & { track: LipSyncTrack };

/**
 * Numbers a run's updates and trims each to the frames that changed since the
 * previous one.
 */
export function createRunUpdateEmitter(
  onUpdate: (update: RunPlanUpdate) => void,
): (content: RunUpdateContent) => void {
  let previous: Float32Array | null = null;
  let seq = 0;
  return ({ track, ...rest }) => {
    const frames = track.frames;
    let from = 0;
    if (previous) {
      const shared = Math.min(previous.length, frames.length);
      while (from < shared && previous[from] === frames[from]) from += 1;
      from = Math.floor(from / 5);
    }
    previous = frames;
    seq += 1;
    onUpdate({
      ...rest,
      seq,
      fromFrame: from,
      frames: frames.slice(from * 5),
      frameCount: frames.length / 5,
      events: track.events,
    });
  };
}

export function createLipSyncRunPlanner(
  options: LipSyncRunPlannerOptions,
): LipSyncRunPlanner {
  const extractor = createSpeechFeatureExtractor(options.sampleRate);
  let planner = createLipSyncPlanner({
    text: "",
    hanLanguage: options.hanLanguage,
  });
  /** The planning error that switched the run to the audio alone. */
  let failure: string | null = null;
  let failureReported = false;
  const fail = (error: unknown) => {
    if (failure !== null) throw error;
    failure = error instanceof Error ? error.message : String(error);
    planner = createLipSyncPlanner({ text: "" });
  };
  let text = "";
  let textFinal = false;
  let inParts = false;
  let audioEnded = false;
  let timing: TimedChar[] | null = null;
  let plannedSec = -Infinity;
  const emit = createRunUpdateEmitter(options.onUpdate);
  let cpuMs = 0;
  let done = false;

  const plan = () => {
    if (done) return;
    const started = performance.now();
    const complete = audioEnded && (textFinal || inParts);
    const features = extractor.features();
    let result: LipSyncPlan;
    try {
      result = planner.plan({ features, timing, complete });
    } catch (error) {
      fail(error);
      result = planner.plan({ features, timing: null, complete });
    }
    cpuMs += performance.now() - started;
    plannedSec = extractor.receivedSec();

    emit({
      track: result.track,
      gestures: result.gestures,
      complete,
      fallback: failure !== null ? "planner_failed" : result.fallback,
      ...(failure !== null && !failureReported ? { error: failure } : {}),
      audioSec: plannedSec,
      cpuMs,
    });
    if (failure !== null) failureReported = true;
    if (complete) done = true;
  };

  return {
    setText: (next, final) => {
      if (done || inParts) return;
      text = next;
      textFinal = final;
      if (failure === null) {
        try {
          planner.setText(text);
        } catch (error) {
          fail(error);
        }
      }
      if (audioEnded && textFinal) plan();
    },
    startPart: (partText) => {
      if (done || audioEnded) return;
      inParts = true;
      if (failure !== null) return;
      try {
        planner.startPart(partText, extractor.features());
      } catch (error) {
        fail(error);
      }
    },
    pushPcm: (pcm) => {
      if (done || audioEnded) return;
      const started = performance.now();
      extractor.push(pcm);
      cpuMs += performance.now() - started;
      if (extractor.receivedSec() - plannedSec >= PLAN_STEP_SEC) plan();
    },
    addTiming: (chars) => {
      if (done || !chars.length) return;
      timing = [...(timing ?? []), ...chars];
    },
    endAudio: () => {
      if (done || audioEnded) return;
      const started = performance.now();
      extractor.finish();
      cpuMs += performance.now() - started;
      audioEnded = true;
      // Without final text, the plan completes when the text does.
      if (textFinal || inParts) plan();
    },
  };
}
