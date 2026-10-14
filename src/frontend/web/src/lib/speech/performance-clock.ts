/**
 * A clock shaped like `AudioContext` (only `currentTime`), for speech that
 * plays outside Web Audio: browser speech reports its events on it, and the
 * avatar's lip-sync reads it in place of an audio context.
 */

export function performanceClockNow(): number {
  return performance.now() / 1000;
}

export const performanceClock = {
  get currentTime() {
    return performanceClockNow();
  },
} as unknown as AudioContext;
