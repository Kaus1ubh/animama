/**
 * The lip-sync planner for one speech part: its text becomes units once, then
 * each call aligns them to the audio that has arrived and renders a track.
 *
 * Planning is progressive. Units placed well behind the newest audio (two
 * seconds) are kept, and each call re-aligns only the audio after them with the
 * units still to come, so alignment work per call stays bounded. Loudness
 * levels, rendering and gesture timing still cover the whole part on every
 * call, so their cost grows with its length (about 2 ms a call for a two-minute
 * part, in Node). The speaking rate comes from the units already placed. With
 * `windowed: false` every call re-aligns everything, which the evaluation uses
 * as a reference.
 *
 * When the text has nothing to say (only symbols or punctuation) or cannot be
 * aligned to the audio, the mouth follows the audio alone, and the plan says
 * why.
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

/**
 * Units that end this long before the newest audio are kept. Two seconds of
 * later audio usually settles an ambiguous stretch, such as a breath after
 * "Oh...", before it is kept; one second let such errors push later words
 * early.
 */
const HOLD_SEC = 2;
/** Speech weight placed before the measured speaking rate is trusted. */
const RATE_MIN_WEIGHT = 4;
/**
 * Once a plan has placed a tag for this long, later plans keep it, starting
 * near the same time, so its event does not flicker as audio arrives.
 */
const PIN_TAG_SEC = 0.4;
const PIN_TOLERANCE_SEC = 0.1;
/** Frames of speech that make audio worth following when the text cannot be used. */
const MIN_SPEECH_FRAMES = 10;
/** Partial plans consider units up to this many times the remaining frames. */
const LOOKAHEAD_FACTOR = 1.2;
const LOOKAHEAD_EXTRA_FRAMES = 50;

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
  /**
   * Why part of the mouth follows the audio alone: the text has nothing to say
   * (`no_text`), or no alignment of the text fits the audio (`no_alignment`,
   * a planner failure worth logging).
   */
  fallback: "no_text" | "no_alignment" | null;
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
  // Words or tags: a part of only "[laughs]" still places its laugh.
  const hasText = units.some((unit) => unit.kind !== "pause");
  const windowed = options.windowed ?? true;
  /** Units placed for good, and where the audio after them starts. */
  const committed: AlignedUnit[] = [];
  let committedFrame = 0;
  /** The first text unit not yet placed for good. */
  let nextUnit = 0;
  let placedFrames = 0;
  let placedWeight = 0;
  /** Tags placed by an earlier plan, with their start. */
  const pinned = new Map<LipSyncUnit, number>();

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

    // A pinned tag starts where it was first placed, whatever the timing says.
    timed.units.forEach((unit, index) => {
      const start = pinned.get(unit);
      if (start === undefined) return;
      timed.windows[index] = {
        startSec: start,
        endSec: Infinity,
        toleranceSec: PIN_TOLERANCE_SEC,
      };
    });

    /** The audio from `fromFrame` on, followed by loudness alone. */
    const followAudio = (fromFrame: number): AlignedUnit[] => {
      let speechFrames = 0;
      for (let t = fromFrame; t < frames; t += 1) {
        if (features.loudnessDb[t]! > levels.floor + 4) speechFrames += 1;
      }
      if (speechFrames < MIN_SPEECH_FRAMES) return [];
      return [
        {
          unit: { kind: "unknown", weight: 1, start: 0, end: 0 },
          startSec: fromFrame / rate,
          endSec: frames / rate,
        },
      ];
    };

    let aligned: AlignedUnit[];
    let fallback: LipSyncPlan["fallback"] = null;
    if (!hasText) {
      aligned = followAudio(0);
      if (aligned.length) fallback = "no_text";
    } else if (!windowed) {
      const all = alignUnits(timed.units, features, {
        acoustic: input.acoustic,
        windows: timed.windows,
        partial: !complete,
        levels,
      });
      aligned = all ?? followAudio(0);
      if (!all) fallback = "no_alignment";
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
        required: new Set(pinned.keys()),
      });
      if (!fresh) {
        // Nothing fits after the kept units: follow the audio there, and try
        // again with the next plan.
        const rest = followAudio(committedFrame);
        aligned = [...committed, ...rest];
        if (rest.length) fallback = "no_alignment";
      } else {
        aligned = [...committed, ...fresh];
      }
      if (fresh && !complete) {
        for (const placed of fresh) {
          if (
            placed.unit.kind === "tag" &&
            placed.endSec - placed.startSec >= PIN_TAG_SEC &&
            !pinned.has(placed.unit)
          ) {
            pinned.set(placed.unit, placed.startSec);
          }
        }
        commit(fresh, frames / rate - HOLD_SEC, rate);
      }
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
      fallback,
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
