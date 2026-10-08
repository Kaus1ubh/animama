/**
 * One-off animaPoseClip/1.0 → 2.0 file conversion for #337, loaded by
 * `clip-format-convert.mjs` through Vite's SSR loader. Deleted with the 1.0
 * sampler and converter once Included and Local content are converted.
 */
import { isDeepStrictEqual } from "node:util";

import { getResolvedAvatarPose } from "@/lib/avatar/poses/catalog";
import {
  convertAnimaPoseClipToV2,
  measureAnimaPoseClipConversion,
  type AnimaPoseClipConversionError,
} from "@/lib/avatar/poses/animaPoseClip/convertV2";
import {
  ANIMA_POSE_CLIP_SCHEMA,
  parseAnimaPoseClip,
  type AnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip/schema";
import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  validateAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import { compactClipFile } from "@/lib/avatar/motion-authoring/cli";

/** The tolerances `convertV2.test.ts` holds Included conversions to. */
export const CONVERSION_TOLERANCE = {
  degrees: 0.01,
  metres: 0.0001,
  weight: 0.001,
} as const;

/**
 * 2.0 tracks drive a channel for the whole clip, so a channel that a 1.0
 * clip only drives between some keyframes is also driven, at its held value,
 * where 1.0 left it alone. A channel undriven at a single keyframe instant
 * (a 1.0 keyframe that omits it) is allowed: up to two 120 Hz samples in all,
 * which a looping clip crossing several keyframe instants could exceed.
 */
const ADDED_SAMPLE_ALLOWANCE = 2;

/**
 * Owner-accepted exceptions (2026-10-08): finger-heart-pose's blink accent
 * holds 0 for about 1 s where 1.0 left blink to auto-blink and emotions.
 */
const ACCEPTED_ADDED_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  "finger-heart-pose": ["blink"],
};

/** Fields a conversion must carry over unchanged. */
const KEPT_FIELDS = [
  "id",
  "name",
  "role",
  "playback",
  "events",
  "mutedProceduralLayers",
] as const;

export type ClipConversion =
  | { status: "skipped"; schema: string }
  | {
      status: "converted";
      saved: string;
      bytesBefore: number;
      bytesAfter: number;
      beats: number;
      error: AnimaPoseClipConversionError;
    }
  | { status: "failed"; message: string };

const resolvePose = (id: string) => {
  try {
    return getResolvedAvatarPose(id);
  } catch {
    return null;
  }
};

function schemaOf(value: unknown): string {
  return value && typeof value === "object" && "schema" in value
    ? String((value as { schema: unknown }).schema)
    : "";
}

/**
 * Convert one 1.0 clip file's text to saved 2.0 bytes, or explain why not.
 * Files that are not 1.0 clips are skipped. The saved bytes are re-read and
 * must play like the original within `CONVERSION_TOLERANCE`, keep the
 * identity, loop kind and Reaction fields, and resolve every Pose reference.
 */
export function convertClipFileText(text: string): ClipConversion {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "skipped", schema: "" };
  }
  const schema = schemaOf(raw);
  if (schema !== ANIMA_POSE_CLIP_SCHEMA) return { status: "skipped", schema };
  let clip: AnimaPoseClip;
  try {
    clip = parseAnimaPoseClip(raw);
  } catch (error) {
    return { status: "failed", message: (error as Error).message };
  }
  const missing = missingPoseRefs(clip);
  if (missing.length > 0)
    return {
      status: "failed",
      message: `unresolved Pose references: ${missing.join(", ")}`,
    };
  const compacted = compactClipFile(
    pruneBaseValueTracks(convertAnimaPoseClipToV2(clip, resolvePose)),
  );
  if (!compacted.ok) return { status: "failed", message: compacted.message };
  const problem = compareSaved(clip, raw, compacted.saved);
  if (typeof problem === "string")
    return { status: "failed", message: problem };
  return {
    status: "converted",
    saved: compacted.saved,
    bytesBefore: Buffer.byteLength(text),
    bytesAfter: compacted.savedBytes,
    beats: problem.clip.beats.length,
    error: problem.error,
  };
}

/**
 * Check that stored 2.0 bytes play like the 1.0 original text: the
 * equivalence evidence for files already converted.
 */
export function verifyConvertedClip(
  originalText: string,
  storedText: string,
):
  | { ok: true; error: AnimaPoseClipConversionError }
  | { ok: false; message: string } {
  let clip: AnimaPoseClip;
  let raw: unknown;
  try {
    raw = JSON.parse(originalText);
    clip = parseAnimaPoseClip(raw);
  } catch (error) {
    return { ok: false, message: `original: ${(error as Error).message}` };
  }
  const result = compareSaved(clip, raw, storedText);
  return typeof result === "string"
    ? { ok: false, message: result }
    : { ok: true, error: result.error };
}

function compareSaved(
  clip: AnimaPoseClip,
  raw: unknown,
  savedText: string,
): string | { clip: AnimaPoseClipV2; error: AnimaPoseClipConversionError } {
  const reread = JSON.parse(savedText) as Record<string, unknown>;
  if (reread.schema !== ANIMA_POSE_CLIP_V2_SCHEMA)
    return `stored schema is ${String(reread.schema)}`;
  const validated = validateAnimaPoseClipV2(reread);
  if (!validated.ok)
    return `invalid 2.0: ${validated.issues
      .map(({ path, message }) => `${path}: ${message}`)
      .join("; ")}`;
  // Against the file as written, so parser normalisation counts as a change.
  const original = raw as Record<string, unknown>;
  // An empty events list and no events list mean the same.
  const kept = (value: unknown) =>
    Array.isArray(value) && value.length === 0 ? undefined : value;
  for (const field of KEPT_FIELDS)
    if (!isDeepStrictEqual(kept(original[field]), kept(reread[field])))
      return `${field} changed`;
  if ((clip.loop === true) !== (reread.loop === true))
    return "loop kind changed";
  const error = measureAnimaPoseClipConversion(
    clip,
    validated.clip,
    resolvePose,
  );
  for (const key of Object.keys(
    CONVERSION_TOLERANCE,
  ) as (keyof typeof CONVERSION_TOLERANCE)[])
    if (!(error[key] < CONVERSION_TOLERANCE[key]))
      return `plays differently: ${key} ${error[key]} ≥ ${CONVERSION_TOLERANCE[key]}`;
  const added = Object.entries(error.added)
    .filter(
      ([channel, samples]) =>
        samples > ADDED_SAMPLE_ALLOWANCE &&
        !ACCEPTED_ADDED_CHANNELS[clip.id]?.includes(channel),
    )
    .map(([channel, samples]) => `${channel} (${samples} samples)`);
  if (added.length > 0)
    return `drives channels 1.0 left undriven: ${added.join(", ")}`;
  return { clip: validated.clip, error };
}

/**
 * Saved quaternions and positions keep five decimals (and some Included Pose
 * values were stored rounded), so equal values can differ by about 1e-5.
 */
const BASE_VALUE_EPSILON = 1.5e-5;

/**
 * Drop rotation and hips-position tracks whose every key holds the base
 * pose's value: 2.0 playback takes untracked bones from the base pose, so
 * they only add bytes. Verification still measures the pruned clip.
 */
function pruneBaseValueTracks(clip: AnimaPoseClipV2): AnimaPoseClipV2 {
  const base = clip.basePose ? resolvePose(clip.basePose) : null;
  if (!base) return clip;
  const same = (a: readonly number[] | undefined, b: readonly number[]) =>
    a !== undefined &&
    a.every((value, index) => Math.abs(value - b[index]) < BASE_VALUE_EPSILON);
  const rotations = Object.fromEntries(
    Object.entries(clip.rotations ?? {}).filter(([bone, keys]) => {
      const rotation =
        base.humanoid?.[bone as keyof typeof base.humanoid]?.rotation;
      return !(rotation && keys?.every((key) => same(key.q, rotation)));
    }),
  );
  const pruned: AnimaPoseClipV2 = { ...clip, rotations };
  if (Object.keys(rotations).length === 0) delete pruned.rotations;
  const hips = base.humanoid?.hips?.position;
  const axes = ["x", "y", "z"] as const;
  if (
    hips &&
    clip.hipsPosition &&
    axes.every((axis, index) =>
      clip.hipsPosition?.[axis]?.every(
        (key) => Math.abs(key.v - hips[index]) < BASE_VALUE_EPSILON,
      ),
    )
  )
    delete pruned.hipsPosition;
  return pruned;
}

function missingPoseRefs(clip: AnimaPoseClip): string[] {
  const ids = new Set<string>();
  if (clip.basePose) ids.add(clip.basePose);
  for (const pose of Object.values(clip.poses))
    if (pose && typeof pose === "object" && "ref" in pose) ids.add(pose.ref);
  return [...ids].filter((id) => resolvePose(id) === null);
}
