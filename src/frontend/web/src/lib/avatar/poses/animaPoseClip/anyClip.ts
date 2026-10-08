import { parseAnimaPoseClip, type AnimaPoseClip } from "./schema";
import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  parseAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "./schemaV2";

/** A Pose Clip in either supported schema. */
export type AnyAnimaPoseClip = AnimaPoseClip | AnimaPoseClipV2;

export function isAnimaPoseClipV2(value: unknown): value is AnimaPoseClipV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === ANIMA_POSE_CLIP_V2_SCHEMA
  );
}

/**
 * Clips this function returned. Playback helpers parse their clip argument on
 * every call; a clip this module already sanitized is returned as is instead
 * of being validated again each frame (a dense 1.0 bake costs milliseconds to
 * parse). Treat parsed clips as immutable.
 */
const parsedClips = new WeakSet<object>();

/** Parse a clip of either schema, throwing on invalid input. */
export function parseAnyAnimaPoseClip(value: unknown): AnyAnimaPoseClip {
  if (typeof value === "object" && value !== null && parsedClips.has(value))
    return value as AnyAnimaPoseClip;
  const clip = isAnimaPoseClipV2(value)
    ? parseAnimaPoseClipV2(value)
    : parseAnimaPoseClip(value);
  parsedClips.add(clip);
  return clip;
}

/**
 * Whether a clip moves the body or face. A clip that does not only times its
 * events and must not replace the current pose.
 */
export function animaPoseClipHasPose(clip: AnyAnimaPoseClip): boolean {
  if (!isAnimaPoseClipV2(clip)) return clip.poseKeyframes.length > 0;
  // Validation guarantees every track it keeps has keys.
  const hasTracks = (tracks: object | undefined) =>
    tracks !== undefined && Object.keys(tracks).length > 0;
  return (
    Object.values(clip.joints ?? {}).some(hasTracks) ||
    hasTracks(clip.rotations) ||
    hasTracks(clip.hipsPosition) ||
    hasTracks(clip.hands) ||
    hasTracks(clip.expressions)
  );
}
