import { easeProgress } from "../animaPoseClip/interpolation";
import type { AnimaPoseClipEase } from "../animaPoseClip/schemaV2";

/** A key with its time and value resolved. */
export type ResolvedKey = {
  t: number;
  v: number;
  /** `flat` stops motion at the key; `auto` lets velocity carry through. */
  tangent: "auto" | "flat";
  /** How motion arrives at this key from the previous one. */
  ease: AnimaPoseClipEase;
};

/**
 * A scalar track. Segments arrive at each key with that key's ease:
 * `smooth` segments are cubic Hermite with Fritsch–Butland monotone slopes
 * (velocity carries through a key, but a key that is a local peak or valley
 * stops there and no segment overshoots the authored values); `linear`,
 * `hold` and the 1.0 easings interpolate directly. Overshoot and settle are
 * therefore authored explicitly as keys. Outside its keys a track holds the
 * nearest value; a looping track wraps over the clip duration instead.
 */
export class ScalarTrack {
  private readonly keys: ResolvedKey[];
  private readonly slopes: number[];
  private readonly loopDuration: number | null;
  /**
   * A loop with keys at both 0 and its duration: the key at the duration
   * closes the loop (its value and ease shape the end of the cycle), so the
   * seam needs no wrap segment.
   */
  private readonly closed: boolean;

  constructor(keys: readonly ResolvedKey[], loopDuration: number | null) {
    if (keys.length === 0) throw new Error("A track needs at least one key.");
    this.loopDuration = loopDuration;
    this.keys = [...keys];
    const last = keys[keys.length - 1];
    this.closed =
      loopDuration !== null &&
      keys.length > 1 &&
      Math.abs(keys[0].t) < 1e-6 &&
      Math.abs(last.t - loopDuration) < 1e-6;
    this.slopes = this.keys.map((_, index) => this.tangentAt(index));
  }

  evaluate(time: number): number {
    const keys = this.keys;
    if (keys.length === 1) return keys[0].v;
    if (this.loopDuration !== null) return this.evaluateLoop(time);
    if (time <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (time >= last.t) return last.v;
    const index = this.segmentIndex(time);
    return this.evaluateSegment(
      keys[index],
      keys[index + 1],
      this.slopes[index],
      this.slopes[index + 1],
      time,
    );
  }

  private evaluateLoop(time: number): number {
    const period = this.loopDuration!;
    const keys = this.keys;
    const wrapped = ((time % period) + period) % period;
    const last = keys[keys.length - 1];
    if (this.closed || (wrapped >= keys[0].t && wrapped < last.t)) {
      const index = this.segmentIndex(wrapped);
      return this.evaluateSegment(
        keys[index],
        keys[index + 1],
        this.slopes[index],
        this.slopes[index + 1],
        wrapped,
      );
    }
    // The wrap segment runs from the last key to the first key one period later.
    const to = { ...keys[0], t: keys[0].t + period };
    const local = wrapped < keys[0].t ? wrapped + period : wrapped;
    return this.evaluateSegment(
      last,
      to,
      this.slopes[keys.length - 1],
      this.slopes[0],
      local,
    );
  }

  private segmentIndex(time: number): number {
    const keys = this.keys;
    let low = 0;
    let high = keys.length - 2;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (keys[middle].t <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  private evaluateSegment(
    from: ResolvedKey,
    to: ResolvedKey,
    fromSlope: number,
    toSlope: number,
    time: number,
  ): number {
    const span = to.t - from.t;
    const u = span > 0 ? (time - from.t) / span : 1;
    switch (to.ease) {
      case "hold":
        return u >= 1 ? to.v : from.v;
      case "smooth": {
        const u2 = u * u;
        const u3 = u2 * u;
        return (
          (2 * u3 - 3 * u2 + 1) * from.v +
          (u3 - 2 * u2 + u) * span * fromSlope +
          (-2 * u3 + 3 * u2) * to.v +
          (u3 - u2) * span * toSlope
        );
      }
      default:
        return from.v + (to.v - from.v) * easeProgress(u, to.ease);
    }
  }

  /** Slope (value per second) at a key, for smooth segments. */
  private tangentAt(index: number): number {
    const keys = this.keys;
    const key = keys[index];
    if (key.tangent === "flat") return 0;
    const loop = this.loopDuration;
    // In a closed loop, the keys at 0 and the duration are one moment of the
    // cycle, so each takes its neighbour from across the seam.
    const wrapLast = keys.length - (this.closed ? 2 : 1);
    const wrapFirst = this.closed ? 1 : 0;
    const previous =
      index > 0
        ? keys[index - 1]
        : loop !== null
          ? { ...keys[wrapLast], t: keys[wrapLast].t - loop }
          : null;
    const next =
      index < keys.length - 1
        ? keys[index + 1]
        : loop !== null
          ? { ...keys[wrapFirst], t: keys[wrapFirst].t + loop }
          : null;
    // Clip ends start and finish at rest velocity.
    if (!previous || !next) return 0;
    const h0 = key.t - previous.t;
    const h1 = next.t - key.t;
    if (h0 <= 0 || h1 <= 0) return 0;
    const d0 = (key.v - previous.v) / h0;
    const d1 = (next.v - key.v) / h1;
    if (d0 * d1 <= 0) return 0;
    const w0 = 2 * h1 + h0;
    const w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  }
}
