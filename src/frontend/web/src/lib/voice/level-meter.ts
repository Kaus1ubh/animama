/** Level-meter scale: dBFS range shown and where the colour zones start. */
export const METER_MIN_DB = -60;
export const METER_MAX_DB = 0;
/** Green below, yellow from here (comfortable speech peaks sit around -18..-6). */
export const METER_WARN_DB = -18;
/** Red from here: close to clipping. */
export const METER_HOT_DB = -6;

export type MeterZone = "green" | "yellow" | "red";

/** Root-mean-square level of time-domain samples in dBFS (-Infinity for silence). */
export function rmsDbfs(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** How many of `segments` are lit for a level, clamped to the meter range. */
export function litSegments(db: number, segments: number): number {
  if (!Number.isFinite(db) || db <= METER_MIN_DB) return 0;
  const fraction =
    (Math.min(db, METER_MAX_DB) - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
  return Math.round(fraction * segments);
}

/** Colour zone of the segment at `index` (0 = leftmost). */
export function segmentZone(index: number, segments: number): MeterZone {
  const db =
    METER_MIN_DB + ((index + 1) / segments) * (METER_MAX_DB - METER_MIN_DB);
  if (db > METER_HOT_DB) return "red";
  if (db > METER_WARN_DB) return "yellow";
  return "green";
}
