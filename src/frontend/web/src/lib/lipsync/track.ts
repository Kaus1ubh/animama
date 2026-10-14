/**
 * A planned lip-sync track: 60 FPS `vowel5` mouth frames, plus timed events
 * for the non-speech moments (laughs, sighs, pauses and so on) a renderer or
 * expression layer can show.
 */

export const LIPSYNC_FPS = 60;

/** Frame values in this order, matching the `vowel5` avatar contract. */
export const LIPSYNC_VOWELS = ["A", "E", "I", "O", "U"] as const;
export type LipSyncVowel = (typeof LIPSYNC_VOWELS)[number];

export type LipSyncEvent = {
  /** What the moment is, for example `laugh`, `sigh`, `gasp` or `pause`. */
  kind: string;
  startSec: number;
  endSec: number;
  /**
   * The tag that produced it, such as `[laughs]`. Events without one, like a
   * pause at a comma, are not tags.
   */
  label?: string;
};

export type LipSyncTrack = {
  fps: number;
  /** `frameCount * 5` weights in A, E, I, O, U order, each 0–1. */
  frames: Float32Array;
  events: LipSyncEvent[];
};

/** Frames needed to cover `durationSec`, including the frame at the end. */
export function lipSyncFrameCount(
  durationSec: number,
  fps = LIPSYNC_FPS,
): number {
  return Math.ceil(Math.max(0, durationSec) * fps) + 1;
}

export function emptyLipSyncTrack(durationSec: number): LipSyncTrack {
  return {
    fps: LIPSYNC_FPS,
    frames: new Float32Array(lipSyncFrameCount(durationSec) * 5),
    events: [],
  };
}

/** The mouth opening of frame `index`: its largest vowel weight. */
export function frameOpenness(track: LipSyncTrack, index: number): number {
  const offset = index * 5;
  let open = 0;
  for (let k = 0; k < 5; k += 1)
    open = Math.max(open, track.frames[offset + k] ?? 0);
  return open;
}
