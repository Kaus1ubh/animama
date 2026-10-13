/**
 * Runs a plan source on an evaluation clip as the audio would arrive.
 *
 * - `whole`: the source sees the whole clip once, as if all audio had arrived.
 * - `faster`: audio arrives `rate` times faster than real time (Gemini about 2.9×).
 * - `live`: audio arrives in real time, and playback runs `bufferSec` behind it.
 *
 * In the progressive modes the source re-plans every `stepSec` of arrived audio.
 * Each plan fills only the frames that play before the next plan exists, so a
 * frame keeps the value of the last plan made before playback reached it.
 * Feature frames reach a plan once their analysis windows have arrived, and
 * provider timing arrives with its audio, so a plan only sees characters that
 * have started.
 */

import {
  sliceSpeechFeatures,
  speechFeatureFramesReady,
  type SpeechFeatures,
} from "@/lib/lipsync/audio/features";
import {
  emptyLipSyncTrack,
  LIPSYNC_FPS,
  lipSyncFrameCount,
  type LipSyncEvent,
  type LipSyncTrack,
} from "@/lib/lipsync/track";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type { EvalClip } from "./clip";

export type ArrivalMode =
  | { kind: "whole" }
  | { kind: "faster"; rate: number }
  | { kind: "live"; bufferSec: number };

export const ARRIVAL_MODES = {
  whole: { kind: "whole" },
  faster: { kind: "faster", rate: 2.9 },
  live: { kind: "live", bufferSec: 0.3 },
} as const satisfies Record<string, ArrivalMode>;

export type ArrivalModeName = keyof typeof ARRIVAL_MODES;

export type EvalPlanRequest = {
  clip: EvalClip;
  /** Feature frames whose analysis windows have fully arrived. */
  features: SpeechFeatures;
  /** Provider timing for characters that have started, or `null`. */
  timing: TimedChar[] | null;
  arrivedSec: number;
  /** Whether all of the clip's audio has arrived. */
  complete: boolean;
};

export type EvalPlanSource = {
  id: string;
  label: string;
  /** Whether the source can plan from partial audio; otherwise it is only scored whole. */
  progressive: boolean;
  /** Scored only when named with `--source`. */
  optIn?: boolean;
  /** Load what the source needs, such as pronunciation data, before planning. */
  prepare?: () => Promise<void>;
  /**
   * Start planning one clip. The returned function is called with each step's
   * request, in order, so it may keep what earlier plans found.
   */
  start: (clip: EvalClip) => (request: EvalPlanRequest) => LipSyncTrack;
};

export type EvalRun = {
  track: LipSyncTrack;
  /** Number of plans made. */
  runs: number;
  /** CPU spent planning, in milliseconds. */
  cpuMs: number;
};

function request(clip: EvalClip, arrivedSec: number): EvalPlanRequest {
  const complete = arrivedSec >= clip.durationSec;
  const frames = complete
    ? clip.features.loudnessDb.length
    : speechFeatureFramesReady(
        clip.sampleRate,
        Math.round(arrivedSec * clip.sampleRate),
      );
  return {
    clip,
    features: sliceSpeechFeatures(clip.features, frames),
    timing: clip.timing
      ? clip.timing.filter((c) => c.startSec < arrivedSec)
      : null,
    arrivedSec: Math.min(arrivedSec, clip.durationSec),
    complete,
  };
}

/**
 * Add the parts of `plan`'s events that fall in [fromSec, untilSec), merging an
 * event with the committed one it continues.
 */
function commitEvents(
  committed: LipSyncEvent[],
  plan: LipSyncEvent[],
  fromSec: number,
  untilSec: number,
): void {
  for (const event of plan) {
    const start = Math.max(event.startSec, fromSec);
    const end = Math.min(event.endSec, untilSec);
    if (end <= start) continue;
    const previous = committed.find(
      (c) =>
        c.kind === event.kind &&
        Math.abs(c.endSec - start) < 1 / LIPSYNC_FPS + 1e-6,
    );
    if (previous) previous.endSec = Math.max(previous.endSec, end);
    else committed.push({ ...event, startSec: start, endSec: end });
  }
}

export function runPlanSource(
  source: EvalPlanSource,
  clip: EvalClip,
  mode: ArrivalMode,
  stepSec = 0.25,
): EvalRun {
  const plan = source.start(clip);
  if (mode.kind === "whole" || !source.progressive) {
    const started = performance.now();
    const track = plan(request(clip, clip.durationSec));
    return { track, runs: 1, cpuMs: performance.now() - started };
  }

  const total = lipSyncFrameCount(clip.durationSec);
  // Playback position once `arrived` seconds of audio exist: a fixed buffer
  // behind a live stream, or arrived / rate for faster delivery.
  const playheadAt = (arrived: number) =>
    mode.kind === "faster" ? arrived / mode.rate : arrived - mode.bufferSec;
  const out = emptyLipSyncTrack(clip.durationSec);
  let committed = 0;
  let runs = 0;
  let cpuMs = 0;
  for (let arrived = stepSec; ; arrived += stepSec) {
    const req = request(clip, arrived);
    const started = performance.now();
    const track = plan(req);
    cpuMs += performance.now() - started;
    runs += 1;
    // This plan serves every frame that plays from now until the next plan is
    // made. Frames that already played without any plan stay closed.
    const from = req.complete
      ? committed
      : Math.max(committed, Math.ceil(playheadAt(arrived) * LIPSYNC_FPS));
    const until = req.complete
      ? total
      : Math.max(0, Math.ceil(playheadAt(arrived + stepSec) * LIPSYNC_FPS));
    const end = Math.min(until, track.frames.length / 5);
    if (end > from) {
      out.frames.set(track.frames.subarray(from * 5, end * 5), from * 5);
      commitEvents(
        out.events,
        track.events,
        from / LIPSYNC_FPS,
        req.complete ? Infinity : end / LIPSYNC_FPS,
      );
    }
    committed = Math.max(committed, end);
    if (req.complete) break;
  }
  return { track: out, runs, cpuMs };
}
