import type { FramePayload, SegmentMeta } from "./types";

/** A run's planned mouth: Vowel5 frames (A, E, I, O, U) the avatar plays in time. */
export type VowelVisemeLipSyncSegment = {
  segmentId: string;
  meta: SegmentMeta;
  frames: FramePayload[];
  frameCount: number;
  durationMs: number;
  durationSec: number;
  fps: number;
};
