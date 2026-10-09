import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  parseAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "./schemaV2";

export type { AnimaPoseClipV2 };

/** The retired clip schema, recognised only to reject it clearly. */
export const RETIRED_ANIMA_POSE_CLIP_SCHEMA = "animaPoseClip/1.0";

/** Thrown for a clip whose schema this version cannot play, edit or import. */
export class UnsupportedAnimaPoseClipFormatError extends Error {
  readonly schema: string | null;

  constructor(schema: string | null) {
    super(unsupportedAnimaPoseClipFormatMessage(schema));
    this.name = "UnsupportedAnimaPoseClipFormatError";
    this.schema = schema;
  }
}

/** The user-facing reason a clip with this schema is rejected. */
export function unsupportedAnimaPoseClipFormatMessage(
  schema: string | null,
): string {
  return schema === RETIRED_ANIMA_POSE_CLIP_SCHEMA
    ? `This clip uses the retired ${RETIRED_ANIMA_POSE_CLIP_SCHEMA} format, which is no longer supported. Only ${ANIMA_POSE_CLIP_V2_SCHEMA} clips can be played, edited or imported.`
    : `Unsupported clip format${nameable(schema) ? ` "${schema}"` : ""}. Only ${ANIMA_POSE_CLIP_V2_SCHEMA} clips can be played, edited or imported.`;
}

/** Name only a short, printable schema, as the backend does. */
function nameable(schema: string | null): schema is string {
  return (
    schema !== null &&
    schema.length > 0 &&
    schema.length <= 64 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(schema)
  );
}

function schemaOf(value: unknown): string | null {
  const schema =
    typeof value === "object" && value !== null
      ? (value as { schema?: unknown }).schema
      : undefined;
  return typeof schema === "string" ? schema : null;
}

export function isAnimaPoseClipV2(value: unknown): value is AnimaPoseClipV2 {
  return schemaOf(value) === ANIMA_POSE_CLIP_V2_SCHEMA;
}

/**
 * Clips this function returned. Playback helpers parse their clip argument on
 * every call; a clip this module already validated is returned as is instead
 * of being validated again each frame. Treat parsed clips as immutable.
 */
const parsedClips = new WeakSet<object>();

/**
 * Parse an `animaPoseClip/2.0` clip, throwing on invalid input and
 * `UnsupportedAnimaPoseClipFormatError` for any other schema, including the
 * retired `animaPoseClip/1.0`.
 */
export function parseAnimaPoseClip(value: unknown): AnimaPoseClipV2 {
  if (typeof value === "object" && value !== null && parsedClips.has(value))
    return value as AnimaPoseClipV2;
  if (!isAnimaPoseClipV2(value))
    throw new UnsupportedAnimaPoseClipFormatError(schemaOf(value));
  const clip = parseAnimaPoseClipV2(value);
  parsedClips.add(clip);
  return clip;
}

/**
 * Whether a clip moves the body or face. A clip that does not only times its
 * events and must not replace the current pose.
 */
export function animaPoseClipHasPose(clip: AnimaPoseClipV2): boolean {
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
