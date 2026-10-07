import type { VRMHumanBoneName } from "@pixiv/three-vrm";

import { isVRMHumanBoneName } from "../animaPose";
import { getAnimaPoseClipTimelineDuration } from "./playback";
import { sampleAnimaPoseClip } from "./sampling";
import {
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  isAnimaPoseClipRef,
  type AnimaPoseClip,
  type AnimaPoseClipPoseResolver,
  type QuaternionTuple,
} from "./schema";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS,
  ANIMA_POSE_CLIP_V2_SCHEMA,
  fromAnimaPoseClipTicks,
  toAnimaPoseClipTicks,
  type AnimaPoseClipBeat,
  type AnimaPoseClipEase,
  type AnimaPoseClipRotationKey,
  type AnimaPoseClipScalarKey,
  type AnimaPoseClipV2,
} from "./schemaV2";

/** 1.0 fields that conversion replaces with beats and tracks. */
const REPLACED_FIELDS = new Set([
  "schema",
  "poses",
  "poseKeyframes",
  "defaultTransition",
]);

/**
 * Convert a 1.0 clip to 2.0 with the same motion: one beat per keyframe
 * (labelled from its pose name) and rotation, hips-position and expression
 * tracks keyed at every beat with the keyframe's easing. Pose references and
 * the base pose are resolved by value, as Pose insertion copies values.
 *
 * A 1.0 loop's hold-then-snap seam is reproduced with a `hold` arrival at
 * its first beat (and a "Loop start" beat when its first keyframe is after
 * 0). Two 1.0 behaviours are not reproduced (no Included clip uses them): a
 * bone that a keyframe omits without a base pose holds its last value instead
 * of jumping, and `nlerp` rotations become slerp.
 *
 * `baseBeatLabel` labels the beats of keyframes that reference the clip's
 * base pose (the creator's base endpoints).
 */
export function convertAnimaPoseClipToV2(
  clip: AnimaPoseClip,
  resolvePose: AnimaPoseClipPoseResolver,
  options: { baseBeatLabel?: string } = {},
): AnimaPoseClipV2 {
  const keyframes = clip.poseKeyframes;
  const loop = clip.loop === true;
  const beats: AnimaPoseClipBeat[] = [];
  const usedIds = new Set<string>();
  keyframes.forEach((keyframe, index) => {
    const easing =
      keyframe.transition?.easing ??
      clip.defaultTransition?.easing ??
      DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing;
    const pose = clip.poses[keyframe.pose];
    const isBase =
      options.baseBeatLabel !== undefined &&
      clip.basePose !== undefined &&
      isAnimaPoseClipRef(pose) &&
      pose.ref === clip.basePose;
    beats.push({
      id: uniqueId(slug(keyframe.pose) || `beat-${index + 1}`, usedIds),
      label: (isBase
        ? options.baseBeatLabel!
        : humanize(keyframe.pose) || `Beat ${index + 1}`
      ).slice(0, ANIMA_POSE_CLIP_V2_LIMITS.labelLength),
      // 1.0 keyframes only need to increase; 2.0 beats sit at least
      // ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS apart once saved, so very
      // close keyframes are spread by at most that much.
      time:
        index === 0
          ? keyframe.time
          : fromAnimaPoseClipTicks(
              Math.max(
                toAnimaPoseClipTicks(keyframe.time),
                toAnimaPoseClipTicks(beats[index - 1].time) +
                  ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS,
              ),
            ),
      ease: easing,
    });
  });
  const interpolations = keyframes.map((keyframe) => ({
    ...DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation,
    ...clip.defaultTransition?.interpolation,
    ...keyframe.transition?.interpolation,
  }));
  // Sample each keyframe without wrapping: a loop's keyframe at its duration
  // would otherwise read as the first one.
  const samples = keyframes.map(
    (keyframe) =>
      sampleAnimaPoseClip({ ...clip, loop: false }, keyframe.time, resolvePose)
        .sample,
  );
  if (loop && beats.length > 0) {
    // A 1.0 loop holds its last keyframe until the duration, then snaps to
    // the first: arrive at the first keyframe with a hold across the seam.
    if (
      toAnimaPoseClipTicks(beats[0].time) < ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS
    ) {
      // Too close to 0 for a beat of its own: start the cycle on it.
      beats[0].time = 0;
    } else {
      // It also holds the first keyframe from the start of each cycle.
      beats.unshift({
        id: uniqueId("loop-start", usedIds),
        label: "Loop start",
        time: 0,
      });
      samples.unshift(samples[0]);
      interpolations.unshift(interpolations[0]);
    }
    beats[0].ease = "hold";
  }
  const interpolation = (index: number) => interpolations[index];

  const rotations: Partial<
    Record<VRMHumanBoneName, AnimaPoseClipRotationKey[]>
  > = {};
  const positions: Partial<Record<"x" | "y" | "z", AnimaPoseClipScalarKey[]>> =
    {};
  const bones = new Set<VRMHumanBoneName>();
  for (const sample of samples)
    for (const bone of Object.keys(sample.humanoid ?? {}))
      if (isVRMHumanBoneName(bone)) bones.add(bone);
  for (const bone of [...bones].sort()) {
    const values = holdMissing(
      samples.map((sample) => sample.humanoid?.[bone]?.rotation),
    );
    if (values.length > 0)
      rotations[bone] = values.map((q, index) => ({
        beat: beats[index].id,
        q: q as QuaternionTuple,
        ...(interpolation(index).humanoidRotation === "step"
          ? { ease: "hold" as const }
          : {}),
      }));
  }
  const hips = holdMissing(
    samples.map((sample) => sample.humanoid?.hips?.position),
  );
  if (hips.length > 0)
    (["x", "y", "z"] as const).forEach((axis, component) => {
      positions[axis] = hips.map((position, index) => ({
        beat: beats[index].id,
        v: position[component],
        ...positionEase(interpolation(index).humanoidPosition),
      }));
    });

  const expressionNames = new Set<string>();
  for (const sample of samples)
    for (const name of Object.keys(sample.expressions ?? {}))
      expressionNames.add(name);
  const expressions = Object.fromEntries(
    [...expressionNames].sort().map((name) => [
      name,
      samples.map(
        (sample, index): AnimaPoseClipScalarKey => ({
          beat: beats[index].id,
          // 1.0 treats an omitted expression as 0.
          v: sample.expressions?.[name] ?? 0,
          ...positionEase(interpolation(index).expression),
        }),
      ),
    ]),
  );

  const kept = Object.fromEntries(
    Object.entries(clip).filter(([key]) => !REPLACED_FIELDS.has(key)),
  );
  return {
    ...kept,
    schema: ANIMA_POSE_CLIP_V2_SCHEMA,
    id: clip.id,
    name: clip.name,
    duration:
      Math.max(
        getAnimaPoseClipTimelineDuration(clip),
        beats.at(-1)?.time ?? 0,
      ) || 1,
    beats,
    ...(Object.keys(rotations).length > 0 ? { rotations } : {}),
    ...(Object.keys(positions).length > 0 ? { hipsPosition: positions } : {}),
    ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
  } as AnimaPoseClipV2;
}

/** Scalar interpolation as a key ease: `step` holds; linear keeps the beat's easing. */
function positionEase(interpolation: string): { ease?: AnimaPoseClipEase } {
  return interpolation === "step" ? { ease: "hold" } : {};
}

/** Fill keyframes that omit a value with the previous (or first) defined one. */
function holdMissing<T>(values: readonly (T | undefined)[]): T[] {
  const first = values.find((value) => value !== undefined);
  if (first === undefined) return [];
  let previous = first;
  return values.map((value) => (previous = value ?? previous));
}

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let index = 2; used.has(id); index += 1) id = `${base}-${index}`;
  used.add(id);
  return id;
}
