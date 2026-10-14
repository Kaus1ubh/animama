/**
 * Turns aligned units into a lip-sync track: 60 FPS `vowel5` frames and timed
 * events. The units give the mouth's shape; the audio's loudness gives how far
 * it opens, so quiet syllables move a little and silence stays closed.
 *
 * - a syllable shows its vowel, smaller when weak or whispered;
 * - an unknown-vowel unit (a kanji without a reading) shows a neutral opening;
 * - lip closures shut the mouth at their centre; nasals nearly close it;
 * - pauses and silent tags keep the mouth closed;
 * - laughs open wide and pulse with their loudness, sighs relax into a rounded
 *   shape that closes through the exhale, gasps open quickly, and other vocal
 *   sounds follow loudness with the neutral shape;
 * - each tag becomes an event (kind, start, end, label), and each pause an
 *   unlabelled `pause` event;
 * - the finished frames are smoothed without delay, since they are planned ahead
 *   of playback, so the mouth does not jump with each loudness dip or closure.
 *   Frames left shut stay shut, and the mouth eases into them.
 */

import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import {
  LIPSYNC_FPS,
  lipSyncFrameCount,
  type LipSyncEvent,
  type LipSyncTrack,
  type LipSyncVowel,
  LIPSYNC_VOWELS,
} from "@/lib/lipsync/track";
import type { AlignedUnit, LoudnessLevels } from "@/lib/lipsync/align/aligner";

/** Seconds over which a vowel blends into its neighbours at its edges. */
const COARTICULATION_SEC = 0.04;
/** Frames on each side of the crossfade between vowel targets. */
const BLEND_RADIUS = 2;
const WEAK_SCALE = 0.6;
const WHISPER_SCALE = 0.7;
/** The neutral opening for a sound whose vowel is unknown. */
const NEUTRAL: Partial<Record<LipSyncVowel, number>> = { A: 0.5, E: 0.25 };
/** Without audio, laughs pulse at about this rate. */
const LAUGH_PULSE_HZ = 5;
/** The smoothing's spread (a Gaussian's standard deviation), in seconds. */
const SMOOTH_SEC = 0.035;
/** Frames next to a shut frame over which the smoothed mouth eases shut. */
const SHUT_EASE_FRAMES = 2;

const VOWEL_INDEX = Object.fromEntries(
  LIPSYNC_VOWELS.map((vowel, index) => [vowel, index]),
) as Record<LipSyncVowel, number>;

/** One-pole attack and release follower, applied causally. */
function attackRelease(
  values: Float32Array,
  rate: number,
  attackSec: number,
  releaseSec: number,
): Float32Array {
  const out = new Float32Array(values.length);
  const attack = 1 - Math.exp(-1 / (attackSec * rate));
  const release = 1 - Math.exp(-1 / (releaseSec * rate));
  let state = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    state += (value > state ? attack : release) * (value - state);
    out[i] = state;
  }
  return out;
}

/**
 * Smooth each `vowel5` channel with a Gaussian over neighbouring frames. Shut
 * frames (all channels zero: silences, pauses, closures' centres) stay shut,
 * and the frames beside them ease towards zero, so smoothing does not open
 * the mouth into a silence.
 */
export function smoothFrames(frames: Float32Array): Float32Array {
  const count = frames.length / 5;
  const sigma = SMOOTH_SEC * LIPSYNC_FPS;
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
  );
  const shut = new Uint8Array(count);
  for (let f = 0; f < count; f += 1) {
    let sum = 0;
    for (let k = 0; k < 5; k += 1) sum += frames[f * 5 + k]!;
    shut[f] = sum === 0 ? 1 : 0;
  }
  const out = new Float32Array(frames.length);
  for (let f = 0; f < count; f += 1) {
    if (shut[f]) continue;
    // Frames beside a shut one ease towards it: 1/3, then 2/3 of the way open.
    let ease = 1;
    for (let d = 1; d <= SHUT_EASE_FRAMES; d += 1) {
      if (shut[f - d] || shut[f + d]) {
        ease = d / (SHUT_EASE_FRAMES + 1);
        break;
      }
    }
    for (let k = 0; k < 5; k += 1) {
      let sum = 0;
      let weights = 0;
      for (let i = 0; i < kernel.length; i += 1) {
        const g = f + i - radius;
        if (g < 0 || g >= count) continue;
        sum += frames[g * 5 + k]! * kernel[i]!;
        weights += kernel[i]!;
      }
      out[f * 5 + k] = (sum / weights) * ease;
    }
  }
  return out;
}

/** Frames this far under the peak are silent to the eye, whatever the floor. */
const CLOSED_BELOW_PEAK_DB = 30;
/**
 * Speech peaks at least this loud (the test set's quietest, a whisper, peaks at
 * -22 dBFS), so a laugh or gasp at the start of a part does not open the mouth
 * fully just because nothing louder has arrived yet.
 */
const OPENNESS_MIN_PEAK_DB = -20;

/**
 * How far the mouth may open in each 60 FPS frame, 0–1, from loudness between
 * the clip's floor and a little under its peak, smoothed with a fast attack.
 */
export function speechOpenness(
  features: SpeechFeatures,
  levels: LoudnessLevels,
  frameCount: number,
): Float32Array {
  const peak = Math.max(levels.peak, OPENNESS_MIN_PEAK_DB);
  const floor = Math.max(levels.floor, peak - CLOSED_BELOW_PEAK_DB);
  const span = Math.max(1, peak - 4 - floor);
  const last = features.loudnessDb.length - 1;
  const raw = new Float32Array(frameCount);
  if (last < 0) return raw;
  for (let f = 0; f < frameCount; f += 1) {
    const index = Math.min(last, Math.round((f / LIPSYNC_FPS) * features.rate));
    raw[f] = Math.min(
      1,
      Math.max(0, (features.loudnessDb[index]! - floor) / span),
    );
  }
  return attackRelease(raw, LIPSYNC_FPS, 0.025, 0.04);
}

/**
 * Render aligned units over `durationSec`. Without `openness` the mouth opens
 * to a fixed height inside syllables (a text-only estimate).
 */
export function renderAlignedUnits(
  aligned: readonly AlignedUnit[],
  durationSec: number,
  openness: Float32Array | null,
): LipSyncTrack {
  const count = lipSyncFrameCount(durationSec);
  const open = openness ?? new Float32Array(count).fill(0.7);
  const target = new Float32Array(count * 5);
  const gate = new Float32Array(count).fill(1);
  const events: LipSyncEvent[] = [];
  const raise = (f: number, vowel: LipSyncVowel, value: number) => {
    const at = f * 5 + VOWEL_INDEX[vowel];
    target[at] = Math.max(target[at]!, value);
  };
  const neutral = (f: number, scale: number) => {
    for (const [vowel, value] of Object.entries(NEUTRAL)) {
      raise(f, vowel as LipSyncVowel, value * scale);
    }
  };

  for (const { unit, startSec, endSec } of aligned) {
    if (unit.kind === "tag") {
      events.push({
        kind: unit.tag!.kind,
        startSec,
        endSec,
        label: unit.tag!.label,
      });
    } else if (unit.kind === "pause") {
      events.push({ kind: "pause", startSec, endSec });
    }
    const first = Math.max(0, Math.floor(startSec * LIPSYNC_FPS));
    const end = Math.min(count, Math.ceil(endSec * LIPSYNC_FPS));
    const length = Math.max(0.05, endSec - startSec);
    for (let f = first; f < end; f += 1) {
      const t = f / LIPSYNC_FPS;
      const scale =
        (unit.weak ? WEAK_SCALE : 1) * (unit.whisper ? WHISPER_SCALE : 1);
      switch (unit.kind) {
        case "syllable": {
          // Full inside the syllable, half at its edges.
          const edge = Math.min(
            1,
            (t - startSec) / COARTICULATION_SEC + 0.5,
            (endSec - t) / COARTICULATION_SEC + 0.5,
          );
          raise(f, unit.vowel!, Math.max(0.35, edge) * scale);
          break;
        }
        case "unknown":
          neutral(f, scale);
          break;
        case "closure": {
          const middle = (startSec + endSec) / 2;
          const halfWidth = Math.max(0.02, (endSec - startSec) / 2);
          gate[f] = Math.min(gate[f]!, Math.abs(t - middle) / halfWidth);
          break;
        }
        case "nasal":
          raise(f, "U", 0.25);
          gate[f] = Math.min(gate[f]!, 0.45);
          break;
        case "pause":
          gate[f] = 0;
          break;
        case "tag": {
          const progress = (t - startSec) / length;
          switch (unit.tag!.kind) {
            case "laugh":
              // Open "A", pulsing with the laugh's loudness (or at about 5 Hz
              // without audio), with a little "I" to spread the lips.
              raise(
                f,
                "A",
                openness
                  ? 1
                  : 0.55 +
                      0.45 *
                        Math.sin(2 * Math.PI * LAUGH_PULSE_HZ * (t - startSec)),
              );
              raise(f, "I", 0.35);
              break;
            case "sigh":
              raise(f, "O", 0.7 * (1 - 0.6 * progress));
              raise(f, "A", 0.2);
              break;
            case "gasp":
              raise(f, "A", 0.8);
              raise(f, "O", 0.6);
              break;
            case "vocal":
              neutral(f, 1);
              break;
            default:
              // Pauses and sound effects: the mouth rests.
              gate[f] = 0;
          }
          break;
        }
      }
    }
    if (unit.kind === "closure") {
      // The frame at a closure's centre shuts the lips exactly, so smoothing
      // eases into it rather than averaging the closure away.
      const centre = Math.round(((startSec + endSec) / 2) * LIPSYNC_FPS);
      if (centre >= 0 && centre < count) gate[centre] = 0;
    }
  }

  // A short crossfade between vowel targets, so units do not switch in one frame.
  const frames = new Float32Array(count * 5);
  for (let f = 0; f < count; f += 1) {
    // The mouth opens with loudness, with a floor so quiet syllables still move.
    const level = open[f]!;
    const opening =
      level > 0.02 ? Math.min(1, 0.15 + level) * gate[f]! * 0.95 : 0;
    if (opening === 0) continue;
    for (let k = 0; k < 5; k += 1) {
      let sum = 0;
      let weights = 0;
      for (let d = -BLEND_RADIUS; d <= BLEND_RADIUS; d += 1) {
        const g = f + d;
        if (g < 0 || g >= count) continue;
        const weight = BLEND_RADIUS + 1 - Math.abs(d);
        sum += target[g * 5 + k]! * weight;
        weights += weight;
      }
      frames[f * 5 + k] = Math.min(1, (sum / weights) * opening);
    }
  }
  return { fps: LIPSYNC_FPS, frames: smoothFrames(frames), events };
}
