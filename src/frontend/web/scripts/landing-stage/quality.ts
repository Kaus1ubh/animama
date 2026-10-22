/**
 * Canvas resolutions (device pixels per CSS pixel) to step through, highest
 * first. Below the screen's own ratio the 3D softens slightly but costs far
 * less to draw.
 */
const PIXEL_RATIOS = [2, 1.5, 1.25, 1, 0.75];
/** Frames are judged in windows of this many seconds. */
const WINDOW_SEC = 2;
/** A window averaging slower than this (about 45 fps) steps down. */
const SLOW_FRAME_SEC = 1 / 45;
/**
 * Windows averaging quicker than this (about 55 fps, so a 60 Hz screen
 * running smoothly) for `RECOVER_SEC` step back up. The gap between the two
 * thresholds keeps it from flickering between steps.
 */
const QUICK_FRAME_SEC = 1 / 55;
const RECOVER_SEC = 8;
/** Seconds to wait after a change or a load before judging again. */
const SETTLE_SEC = 3;
/** A frame this long is a hitch (a load, a hidden tab), not a trend. */
const HITCH_SEC = 0.1;

/**
 * Keeps the 3D canvas smooth on weaker machines and sharp on strong ones:
 * lowers its resolution a step when frames run slow, and raises it again
 * after a long run of quick frames. It starts at the screen's own ratio
 * (at most 2).
 */
export class ResolutionGovernor {
  readonly #ratios: number[];
  #step = 0;
  #quietUntil = 0;
  #sum = 0;
  #frames = 0;
  #quickFor = 0;

  constructor(screenRatio: number) {
    const top = Math.min(screenRatio, PIXEL_RATIOS[0]);
    this.#ratios = [top, ...PIXEL_RATIOS.filter((ratio) => ratio < top)];
  }

  get ratio() {
    return this.#ratios[this.#step];
  }

  /** Judge nothing for a while: frames run slow while something loads. */
  settle(now: number) {
    this.#quietUntil = now + SETTLE_SEC;
    this.#sum = 0;
    this.#frames = 0;
    this.#quickFor = 0;
  }

  /**
   * Record a frame that took `delta` seconds at session time `now`; returns
   * the new ratio when it changes, else null.
   */
  sample(now: number, delta: number): number | null {
    if (now < this.#quietUntil || delta >= HITCH_SEC) return null;
    this.#sum += delta;
    this.#frames += 1;
    if (this.#sum < WINDOW_SEC) return null;
    const average = this.#sum / this.#frames;
    const window = this.#sum;
    this.#sum = 0;
    this.#frames = 0;
    if (average > SLOW_FRAME_SEC && this.#step < this.#ratios.length - 1) {
      this.#step += 1;
      this.settle(now);
      return this.ratio;
    }
    this.#quickFor = average < QUICK_FRAME_SEC ? this.#quickFor + window : 0;
    if (this.#quickFor >= RECOVER_SEC && this.#step > 0) {
      this.#step -= 1;
      this.settle(now);
      return this.ratio;
    }
    return null;
  }
}
