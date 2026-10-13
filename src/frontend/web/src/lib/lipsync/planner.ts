/**
 * The lip-sync planner for one speech part: its text becomes units once, then
 * each call aligns them to the audio that has arrived and renders a track.
 *
 * Planning is progressive. Units placed well behind the newest audio (one
 * second) are kept, and each call re-aligns only the audio after them with the
 * units still to come, so the work per call stays small however long the part
 * is. The speaking rate comes from the units already placed. With
 * `windowed: false` every call re-aligns everything, which the evaluation uses
 * as a reference.
 */

import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import {
  alignUnits,
  DEFAULT_FRAMES_PER_WEIGHT,
  loudnessLevels,
  type AcousticEvidence,
  type AlignedUnit,
  type UnitWindow,
} from "./align/aligner";
import { unitTimingWindows } from "./align/timing-windows";
import { speechGestureTiming, type SpeechGestureTiming } from "./render/beats";
import { renderAlignedUnits, speechOpenness } from "./render/render";
import { detectHanLanguage, textToUnits } from "./text/text-units";
import type { LipSyncUnit } from "./text/units";
import { lipSyncFrameCount, type LipSyncTrack } from "./track";

/** Units that end this long before the newest audio are kept. */
const HOLD_SEC = 1;
/** Speech weight placed before the measured speaking rate is trusted. */
const RATE_MIN_WEIGHT = 4;
/** Partial plans consider units up to this many times the remaining frames. */
const LOOKAHEAD_FACTOR = 1.5;
const LOOKAHEAD_EXTRA_FRAMES = 100;

export type LipSyncPlannerOptions = {
  /** The text sent to the voice, tags included. */
  text: string;
  /** How Han characters read; detected from `text` when omitted. */
  hanLanguage?: "ja" | "zh";
  /** Re-align only the newest audio (default) or everything on every call. */
  windowed?: boolean;
};

export type LipSyncPlanInput = {
  /** Feature frames for all audio that has arrived. */
  features: SpeechFeatures;
  /** Provider character timing so far, on the same clock as the audio. */
  timing: readonly TimedChar[] | null;
  /** Whether all of the part's audio has arrived. */
  complete: boolean;
  acoustic?: AcousticEvidence;
};

export type LipSyncPlan = {
  track: LipSyncTrack;
  aligned: AlignedUnit[];
  gestures: SpeechGestureTiming;
};

export type LipSyncPlanner = {
  units: readonly LipSyncUnit[];
  plan: (input: LipSyncPlanInput) => LipSyncPlan;
};

const isSpeech = (unit: LipSyncUnit) =>
  unit.kind !== "pause" && unit.kind !== "tag";

export function createLipSyncPlanner(
  options: LipSyncPlannerOptions,
): LipSyncPlanner {
  const units = textToUnits(options.text, {
    hanLanguage: options.hanLanguage ?? detectHanLanguage(options.text),
  });
  const textUnits = new Set(units);
  const windowed = options.windowed ?? true;
  /** Units placed for good, and where the audio after them starts. */
  const committed: AlignedUnit[] = [];
  let committedFrame = 0;
  /** The first text unit not yet placed for good. */
  let nextUnit = 0;
  let placedFrames = 0;
  let placedWeight = 0;

  const plan = (input: LipSyncPlanInput): LipSyncPlan => {
    const { features, complete } = input;
    const rate = features.rate;
    const frames = features.loudnessDb.length;
    const levels = loudnessLevels(features.loudnessDb);
    const timed = input.timing
      ? unitTimingWindows(options.text, units, input.timing, {
          horizonSec: complete ? undefined : frames / rate,
        })
      : { units: [...units], windows: units.map(() => null) };

    let aligned: AlignedUnit[];
    if (!windowed) {
      aligned = alignUnits(timed.units, features, {
        acoustic: input.acoustic,
        windows: timed.windows,
        partial: !complete,
        levels,
      });
    } else {
      // The units still to place: from the next text unit, with a gap pause
      // the timing put just before it.
      let first = timed.units.indexOf(units[nextUnit]!);
      if (first < 0) first = timed.units.length;
      if (first > 0 && !textUnits.has(timed.units[first - 1]!)) first -= 1;
      const framesPerWeight =
        placedWeight >= RATE_MIN_WEIGHT
          ? placedFrames / placedWeight
          : complete && !committed.length
            ? undefined
            : DEFAULT_FRAMES_PER_WEIGHT;
      let last = timed.units.length;
      if (!complete) {
        // Only units the remaining audio could reach.
        const reach =
          (frames - committedFrame) * LOOKAHEAD_FACTOR + LOOKAHEAD_EXTRA_FRAMES;
        let expected = 0;
        for (last = first; last < timed.units.length && expected < reach; ) {
          const unit = timed.units[last]!;
          expected += isSpeech(unit)
            ? unit.weight * (framesPerWeight ?? DEFAULT_FRAMES_PER_WEIGHT)
            : unit.weight * rate * (unit.kind === "pause" ? 0.5 : 1);
          last += 1;
        }
      }
      const fresh = alignUnits(timed.units.slice(first, last), features, {
        acoustic: input.acoustic,
        windows: timed.windows.slice(first, last) as Array<UnitWindow | null>,
        partial: !complete,
        fromFrame: committedFrame,
        levels,
        framesPerWeight,
      });
      aligned = [...committed, ...fresh];
      if (!complete) commit(fresh, frames / rate - HOLD_SEC, rate);
    }

    const durationSec = frames / rate;
    const openness = speechOpenness(
      features,
      levels,
      lipSyncFrameCount(durationSec),
    );
    return {
      track: renderAlignedUnits(aligned, durationSec, openness),
      aligned,
      gestures: speechGestureTiming(aligned, features),
    };
  };

  /** Keep the units that end before `beforeSec`, up to the last text unit. */
  const commit = (fresh: AlignedUnit[], beforeSec: number, rate: number) => {
    let keep = 0;
    // Never the newest unit, which may still be sounding.
    for (let k = 0; k < fresh.length - 1; k += 1) {
      if (fresh[k]!.endSec > beforeSec) break;
      if (textUnits.has(fresh[k]!.unit)) keep = k + 1;
    }
    if (!keep) return;
    for (const placed of fresh.slice(0, keep)) {
      committed.push(placed);
      if (isSpeech(placed.unit)) {
        placedWeight += placed.unit.weight;
        placedFrames += (placed.endSec - placed.startSec) * rate;
      }
    }
    const last = fresh[keep - 1]!;
    nextUnit = units.indexOf(last.unit) + 1;
    committedFrame = Math.round(last.endSec * rate);
  };

  return { units, plan };
}
