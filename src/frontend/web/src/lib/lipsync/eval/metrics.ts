/**
 * Lip-sync scores against a clip's reference timings, at 60 FPS, where a
 * frame's openness is its largest vowel weight:
 *
 * - `vowelOpen`: share of reference-vowel frames with the mouth open;
 * - `openInSilence`: share of quiet frames in reference gaps (150 ms or more
 *   with no word, trimmed by 3 frames, 50 ms, at each end) with the mouth open.
 *   Lower is better;
 * - `nonspeechOpen`: mean openness in audible gap frames (laughs, sighs, gasps);
 * - `corr` and `lagMs`: correlation of openness with reference vowel activity
 *   at zero lag, and the best lag within ±250 ms (positive means the mouth is late);
 * - `vowelMatch`: in Japanese, Korean, Chinese and Spanish, the share of open
 *   reference-vowel frames whose strongest vowel is the reference vowel;
 * - `tagIous`: the best intersection-over-union with a reference gap of each
 *   event a tag produced (one with a `label`). Pauses from punctuation do not count.
 *
 * These follow the research brief's scoring (`docs/plans/lipsync-upgrade/`).
 */

import {
  frameOpenness,
  LIPSYNC_FPS,
  lipSyncFrameCount,
  type LipSyncTrack,
} from "@/lib/lipsync/track";
import type { EvalClip, EvalReference } from "./clip";

export const OPEN_THRESHOLD = 0.15;
const MIN_GAP_SEC = 0.15;
// The brief's 60 ms margin, truncated to whole frames as its scoring did.
const GAP_MARGIN_FRAMES = Math.trunc(0.06 * LIPSYNC_FPS);
const QUIET_BELOW_PEAK_DB = 35;
const MAX_LAG_FRAMES = 15;

/** Event kinds that are placed as intervals and scored as tags. */
export const SCORED_TAG_KINDS = new Set([
  "laugh",
  "sigh",
  "gasp",
  "vocal",
  "pause",
  "sound_effect",
]);

export type ClipScore = {
  vowelOpen: number | null;
  openInSilence: number | null;
  nonspeechOpen: number | null;
  corr: number | null;
  lagMs: number | null;
  vowelMatch: number | null;
  silentFrames: number;
  tagIous: number[];
};

/** Gaps of at least 150 ms with no reference word, including leading and trailing silence. */
export function referenceGaps(
  reference: EvalReference,
  durationSec: number,
): Array<[number, number]> {
  const words = reference.words;
  const gaps: Array<[number, number]> = [];
  if (!words.length) return gaps;
  if (words[0]![0] >= MIN_GAP_SEC) gaps.push([0, words[0]![0]]);
  for (let i = 1; i < words.length; i += 1) {
    const end = words[i - 1]![1];
    const start = words[i]![0];
    if (start - end >= MIN_GAP_SEC) gaps.push([end, start]);
  }
  const last = words[words.length - 1]![1];
  if (durationSec - last >= MIN_GAP_SEC) gaps.push([last, durationSec]);
  return gaps;
}

/** Linear-interpolated percentile, as numpy computes it. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (p / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  const n = Math.min(a.length, b.length);
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va < 1e-12 || vb < 1e-12) return null;
  return cov / Math.sqrt(va * vb);
}

/** Loudness at each 60 FPS frame, interpolated from the clip's 100 Hz features. */
function loudnessAtFrames(clip: EvalClip, n: number): Float32Array {
  const { loudnessDb, rate } = clip.features;
  const out = new Float32Array(n).fill(-100);
  if (!loudnessDb.length) return out;
  for (let f = 0; f < n; f += 1) {
    const position = Math.min(loudnessDb.length - 1, (f / LIPSYNC_FPS) * rate);
    const low = Math.floor(position);
    const high = Math.min(loudnessDb.length - 1, low + 1);
    out[f] =
      loudnessDb[low]! +
      (loudnessDb[high]! - loudnessDb[low]!) * (position - low);
  }
  return out;
}

/** Intersection-over-union of an event with the reference gap it overlaps most. */
export function bestGapIou(
  startSec: number,
  endSec: number,
  gaps: Array<[number, number]>,
): number {
  let best = 0;
  for (const [a, b] of gaps) {
    const iou =
      (Math.min(endSec, b) - Math.max(startSec, a)) /
      (Math.max(endSec, b) - Math.min(startSec, a));
    if (iou > best) best = iou;
  }
  return best;
}

export function scoreClip(track: LipSyncTrack, clip: EvalClip): ClipScore {
  const expected = lipSyncFrameCount(clip.durationSec);
  const n = Math.min(track.frames.length / 5, expected);
  const openness = new Float32Array(n);
  for (let f = 0; f < n; f += 1) openness[f] = frameOpenness(track, f);

  const vowel = new Int8Array(n).fill(-1);
  for (const [v, start, end] of clip.reference.vowels) {
    const a = Math.trunc(start * LIPSYNC_FPS);
    const b = Math.max(a + 1, Math.ceil(end * LIPSYNC_FPS));
    for (let f = Math.max(0, a); f < Math.min(n, b); f += 1) vowel[f] = v;
  }

  const gaps = referenceGaps(clip.reference, clip.durationSec);
  const db = loudnessAtFrames(clip, n);
  const floor = percentile(db, 97) - QUIET_BELOW_PEAK_DB;
  const silent = new Uint8Array(n);
  const audible = new Uint8Array(n);
  for (const [s, e] of gaps) {
    const a = Math.trunc(s * LIPSYNC_FPS) + GAP_MARGIN_FRAMES;
    const b = Math.trunc(e * LIPSYNC_FPS) - GAP_MARGIN_FRAMES;
    for (let f = Math.max(0, a); f < Math.min(n, b); f += 1) {
      if (db[f]! < floor) silent[f] = 1;
      else audible[f] = 1;
    }
  }

  let vowelFrames = 0;
  let vowelOpenFrames = 0;
  let matchFrames = 0;
  let matched = 0;
  let silentFrames = 0;
  let silentOpen = 0;
  let audibleFrames = 0;
  let audibleSum = 0;
  for (let f = 0; f < n; f += 1) {
    if (vowel[f]! >= 0) {
      vowelFrames += 1;
      if (openness[f]! >= OPEN_THRESHOLD) {
        vowelOpenFrames += 1;
        matchFrames += 1;
        let bestIndex = 0;
        for (let k = 1; k < 5; k += 1) {
          if (track.frames[f * 5 + k]! > track.frames[f * 5 + bestIndex]!)
            bestIndex = k;
        }
        if (bestIndex === vowel[f]) matched += 1;
      }
    }
    if (silent[f]) {
      silentFrames += 1;
      if (openness[f]! >= OPEN_THRESHOLD) silentOpen += 1;
    }
    if (audible[f]) {
      audibleFrames += 1;
      audibleSum += openness[f]!;
    }
  }

  // Reference vowel activity, smoothed over five frames.
  const activity = new Float32Array(n);
  for (let f = 0; f < n; f += 1) {
    let sum = 0;
    for (let k = -2; k <= 2; k += 1) {
      const g = f + k;
      if (g >= 0 && g < n && vowel[g]! >= 0) sum += 1;
    }
    activity[f] = sum / 5;
  }
  let zeroCorr: number | null = null;
  let bestCorr = -Infinity;
  let bestLag = 0;
  const shifted = new Float32Array(n);
  for (let lag = -MAX_LAG_FRAMES; lag <= MAX_LAG_FRAMES; lag += 1) {
    for (let f = 0; f < n; f += 1) {
      const g = f + lag;
      shifted[f] = g >= 0 && g < n ? openness[g]! : 0;
    }
    const c = pearson(shifted, activity);
    if (c === null) continue;
    if (lag === 0) zeroCorr = c;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  const tagIous = track.events
    .filter(
      (event) => event.label !== undefined && SCORED_TAG_KINDS.has(event.kind),
    )
    .map((event) =>
      Math.max(0, bestGapIou(event.startSec, event.endSec, gaps)),
    );

  const scoresVowels = clip.lang !== "en";
  return {
    vowelOpen: vowelFrames ? vowelOpenFrames / vowelFrames : null,
    openInSilence: silentFrames ? silentOpen / silentFrames : null,
    nonspeechOpen: audibleFrames ? audibleSum / audibleFrames : null,
    corr: zeroCorr === null ? null : Number(zeroCorr.toFixed(3)),
    lagMs: Number.isFinite(bestCorr)
      ? Math.round((bestLag * 1000) / LIPSYNC_FPS)
      : null,
    vowelMatch: scoresVowels ? (matchFrames ? matched / matchFrames : 0) : null,
    silentFrames,
    tagIous,
  };
}
