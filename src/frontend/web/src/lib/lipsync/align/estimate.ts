/**
 * A text-only estimate of unit timing, for speech whose audio cannot be
 * captured (browser speech): units take their prior durations at an average
 * speaking rate. When word-boundary times are known, the estimate is re-anchored
 * on them: each anchored word starts at its time, and the units between two
 * anchors stretch to fit.
 */

import type { LipSyncUnit } from "@/lib/lipsync/text/units";
import type { AlignedUnit } from "./aligner";

/** Seconds per unit of speech weight: about six syllables a second. */
export const ESTIMATE_SEC_PER_WEIGHT = 0.16;

export type EstimateOptions = {
  startSec?: number;
  secPerWeight?: number;
  /** Known start times of words, by word index. */
  wordStarts?: ReadonlyMap<number, number>;
};

export function estimateUnitTimes(
  units: readonly LipSyncUnit[],
  options: EstimateOptions = {},
): AlignedUnit[] {
  const secPerWeight = options.secPerWeight ?? ESTIMATE_SEC_PER_WEIGHT;
  let at = options.startSec ?? 0;
  const out: AlignedUnit[] = [];
  for (const unit of units) {
    const length =
      unit.kind === "pause" || unit.kind === "tag"
        ? unit.weight
        : unit.weight * secPerWeight;
    out.push({ unit, startSec: at, endSec: at + length });
    at += length;
  }
  const wordStarts = options.wordStarts;
  if (!wordStarts?.size) return out;

  // Anchors: (estimated time, known time) at the first unit of each known word.
  const anchors: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (const { unit, startSec } of out) {
    if (unit.word === undefined || seen.has(unit.word)) continue;
    seen.add(unit.word);
    const known = wordStarts.get(unit.word);
    const last = anchors[anchors.length - 1];
    // Keep anchors in order; a boundary earlier than the previous one is noise.
    if (known !== undefined && (!last || known > last[1])) {
      anchors.push([startSec, known]);
    }
  }
  if (!anchors.length) return out;
  const remap = (sec: number) => {
    const first = anchors[0]!;
    if (sec <= first[0]) return Math.max(0, sec + first[1] - first[0]);
    for (let k = 1; k < anchors.length; k += 1) {
      const [fromEstimate, fromKnown] = anchors[k - 1]!;
      const [toEstimate, toKnown] = anchors[k]!;
      if (sec <= toEstimate) {
        const span = toEstimate - fromEstimate;
        return span > 0
          ? fromKnown + ((sec - fromEstimate) / span) * (toKnown - fromKnown)
          : toKnown;
      }
    }
    const last = anchors[anchors.length - 1]!;
    return sec + last[1] - last[0];
  };
  return out.map((aligned) => ({
    unit: aligned.unit,
    startSec: remap(aligned.startSec),
    endSec: remap(aligned.endSec),
  }));
}
