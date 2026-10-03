import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";

import {
  parseAnimaPoseClip,
  sampleAnimaPoseClip,
  type AnimaPoseClip,
} from "../poses/animaPoseClip";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../poses/catalog";
import {
  JOINT_DEFINITIONS,
  JOINT_IDS,
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
  type JointComponentDefinition,
} from "./anatomy";
import type { MotionContact } from "./description";
import { applyCanonicalPose, rawBoneWorldPosition } from "./kinematics";

/**
 * Automated motion checks for a generated or hand-made Gesture clip.
 *
 * Checks play the clip through the production sampler on each loaded Avatar
 * and report plausibility problems. They cannot establish natural-looking
 * motion; they catch anatomy, continuity, collision and grounding mistakes.
 */

export type MotionCheckCategory =
  | "pose"
  | "range"
  | "smoothness"
  | "intersection"
  | "contact"
  | "feet"
  | "loopSeam"
  | "parity";

export type MotionCheckFinding = {
  category: MotionCheckCategory;
  severity: "fail" | "warn";
  /**
   * Avatar id, or null for checks on the canonical clip values that every
   * Avatar shares (range, smoothness, loop seam, unresolved poses).
   */
  avatar: string | null;
  /** Bone, joint component or body pair the finding concerns. */
  subject: string;
  from: number;
  to: number;
  /** Worst measured value and the limit it crossed, in `unit`. */
  value: number;
  limit: number;
  unit: string;
  detail: string;
};

export type MotionCheckReport = {
  ok: boolean;
  findings: MotionCheckFinding[];
  sampleRate: number;
};

export type MotionCheckAvatar = { id: string; vrm: VRM };

export type MotionCheckOptions = {
  contacts?: readonly MotionContact[];
  /** Check that feet stay at their base-pose positions (default true). */
  plantFeet?: boolean;
  sampleRate?: number;
};

/** Thresholds for every check category. Distances are metres. */
export const MOTION_CHECK_THRESHOLDS = {
  /** Angular speed of a bone, degrees per second (fingers use twice these). */
  velocity: { warn: 360, fail: 900 },
  /**
   * Angular acceleration, degrees per second squared, measured against the
   * rotation extrapolated from the previous two frames (so reversals count).
   * Finite differences assume the default 60 Hz sampling.
   */
  acceleration: { warn: 9000, fail: 18000 },
  /**
   * A stall: speed below `stallSpeed` for at least `stallSeconds` between
   * faster motion (above `stallMotionSpeed`) continuing in the same direction.
   */
  stallSpeed: 8,
  stallMotionSpeed: 60,
  stallSeconds: 0.08,
  stallLookAround: 0.2,
  /** A frame step this large and much larger than its neighbours is a pop. */
  popDegrees: 3,
  popRatio: 4,
  /** Skip arm plane/rotation range checks while the arm hangs (degenerate). */
  armDegenerateElevation: 20,
  /** Penetration beyond the base pose's own, metres. */
  intersectionMargin: 0.015,
  /** Feet: horizontal slide, lift and sink from the base pose. */
  footSlide: 0.02,
  footLift: 0.015,
  footSink: 0.015,
  /** Loop seam angle, degrees. */
  loopSeamDegrees: 0.5,
  /** Disagreement between Avatars in a bone's world rotation from rest, degrees. */
  parityDegrees: 10,
  contactTolerance: 0.06,
} as const;

type Pose = VRMPose;
type Capsule = { a: Vector3; b: Vector3; radius: number };

const T = MOTION_CHECK_THRESHOLDS;
const SIDES = ["left", "right"] as const;

/**
 * Run every check over `clip` on each Avatar and merge per-frame problems into
 * time ranges. The clip may carry fields unknown to the parser.
 */
export function checkMotion(
  clipValue: unknown,
  avatars: readonly MotionCheckAvatar[],
  options: MotionCheckOptions = {},
): MotionCheckReport {
  const clip = parseAnimaPoseClip(clipValue);
  const sampleRate = options.sampleRate ?? 60;
  const duration = clipDuration(clip);
  const times: number[] = [];
  for (let index = 0; index * (1 / sampleRate) < duration - 1e-9; index += 1)
    times.push(index / sampleRate);
  times.push(duration);
  const missingPoseRefs = new Set<string>();
  const poses = times.map((time) => samplePose(clip, time, missingPoseRefs));
  const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};

  const raw: MotionCheckFinding[] = [
    ...[...missingPoseRefs].map(
      (id): MotionCheckFinding => ({
        category: "pose",
        severity: "fail",
        avatar: null,
        subject: id,
        from: 0,
        to: duration,
        value: 0,
        limit: 0,
        unit: "",
        detail:
          "referenced pose is not in the application catalog, so its bones fall back to the T-pose",
      }),
    ),
    ...checkRanges(times, poses),
    ...checkSmoothness(times, poses),
    ...(clip.loop ? checkLoopSeam(clip, duration, sampleRate) : []),
  ];
  const rotationsFromRest: Record<string, Map<string, Quaternion>[]> = {};
  for (const avatar of avatars) {
    const body = new AvatarBody(avatar.vrm);
    const restPositions = body.capture(base);
    const restPenetration = penetrations(body.capsules(restPositions));
    const restRotations = body.rotations({});
    const frames = poses.map((pose) => body.capture(pose));
    rotationsFromRest[avatar.id] = poses.map((pose) =>
      body.rotationsFromRest(pose, restRotations),
    );
    raw.push(
      ...checkIntersections(
        avatar.id,
        times,
        frames.map((frame) => body.capsules(frame)),
        restPenetration,
        options.contacts ?? [],
      ),
      ...checkContacts(avatar.id, times, poses, body, restRotations, options),
      ...(options.plantFeet === false
        ? []
        : checkFeet(avatar.id, times, frames, restPositions)),
    );
  }
  raw.push(...checkParity(times, rotationsFromRest));

  const findings = mergeFindings(raw, 1.5 / sampleRate);
  return {
    ok: findings.every((finding) => finding.severity !== "fail"),
    findings,
    sampleRate,
  };
}

function clipDuration(clip: AnimaPoseClip): number {
  const last = clip.poseKeyframes.at(-1)?.time ?? 0;
  return clip.duration ?? last;
}

/** Resolve pose references the way playback does: from the app catalog. */
function resolveCatalogPose(id: string) {
  try {
    return getResolvedAvatarPose(id);
  } catch {
    return null;
  }
}

function samplePose(
  clip: AnimaPoseClip,
  time: number,
  missingPoseRefs?: Set<string>,
): Pose {
  const result = sampleAnimaPoseClip(clip, time, resolveCatalogPose);
  for (const id of result.diagnostics.missingPoseRefs) missingPoseRefs?.add(id);
  return result.sample.humanoid ?? {};
}

/** Rotation from `a` to `b` expressed as a rotation vector (axis × degrees). */
function rotationStep(a: Quaternion, b: Quaternion): Vector3 {
  const relative = a.clone().invert().multiply(b);
  if (relative.w < 0)
    relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
  const sine = Math.hypot(relative.x, relative.y, relative.z);
  if (sine < 1e-9) return new Vector3();
  const angle = (2 * Math.atan2(sine, relative.w) * 180) / Math.PI;
  return new Vector3(relative.x, relative.y, relative.z).multiplyScalar(
    angle / sine,
  );
}

function rotationOf(pose: Pose, bone: VRMHumanBoneName): Quaternion {
  const rotation = pose[bone]?.rotation;
  return rotation ? new Quaternion(...rotation) : new Quaternion();
}

// ─── Canonical-value checks ────────────────────────────────────────────────

function checkRanges(
  times: readonly number[],
  poses: readonly Pose[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  poses.forEach((pose, index) => {
    for (const id of JOINT_IDS) {
      const joint = resolveJoint(id)!;
      const values = decomposeJointRotation(
        joint,
        rotationOf(pose, joint.bones[0]),
      );
      const components = JOINT_DEFINITIONS[joint.type].components as Record<
        string,
        JointComponentDefinition
      >;
      for (const [name, component] of Object.entries(components)) {
        if (
          joint.type === "upperArm" &&
          name !== "elevation" &&
          values.elevation < T.armDegenerateElevation
        )
          continue;
        const value = values[name];
        const outside = (range: readonly [number, number]) =>
          value < range[0] - 1e-3 || value > range[1] + 1e-3;
        const severity = outside(component.hard)
          ? "fail"
          : outside(component.soft)
            ? "warn"
            : null;
        if (!severity) continue;
        const range = severity === "fail" ? component.hard : component.soft;
        findings.push({
          category: "range",
          severity,
          avatar: null,
          subject: `${id}.${name}`,
          from: times[index],
          to: times[index],
          value: round(value),
          limit: value < range[0] ? range[0] : range[1],
          unit: "°",
          detail: `outside the ${severity === "fail" ? "anatomical limit" : "natural range"} ${range[0]}..${range[1]}`,
        });
      }
    }
  });
  return findings;
}

function checkSmoothness(
  times: readonly number[],
  poses: readonly Pose[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  const bones = new Set<VRMHumanBoneName>();
  for (const pose of poses)
    for (const bone of Object.keys(pose)) bones.add(bone as VRMHumanBoneName);
  const add = (
    bone: string,
    severity: "fail" | "warn",
    from: number,
    to: number,
    value: number,
    limit: number,
    unit: string,
    detail: string,
  ) =>
    findings.push({
      category: "smoothness",
      severity,
      avatar: null,
      subject: bone,
      from,
      to,
      value: round(value),
      limit,
      unit,
      detail,
    });
  for (const bone of bones) {
    const factor = /Thumb|Index|Middle|Ring|Little/.test(bone) ? 2 : 1;
    const rotations = poses.map((pose) => rotationOf(pose, bone));
    // Per-frame rotation vectors (degrees) and their durations.
    const steps = rotations
      .slice(1)
      .map((rotation, index) => rotationStep(rotations[index], rotation));
    const spans = steps.map((_, index) =>
      Math.max(times[index + 1] - times[index], 1e-6),
    );
    const speeds = steps.map((step, index) => step.length() / spans[index]);
    steps.forEach((step, index) => {
      const from = times[index];
      const to = times[index + 1];
      const size = step.length();
      const neighbours = Math.max(
        steps[index - 1]?.length() ?? 0,
        steps[index + 1]?.length() ?? 0,
      );
      if (size > T.popDegrees && size > T.popRatio * neighbours)
        add(
          bone,
          "fail",
          from,
          to,
          size,
          T.popDegrees,
          "° in one frame",
          "discontinuity (pop)",
        );
      const speed = speeds[index];
      if (speed > T.velocity.fail * factor)
        add(
          bone,
          "fail",
          from,
          to,
          speed,
          T.velocity.fail * factor,
          "°/s",
          "angular speed",
        );
      else if (speed > T.velocity.warn * factor)
        add(
          bone,
          "warn",
          from,
          to,
          speed,
          T.velocity.warn * factor,
          "°/s",
          "angular speed",
        );
      if (index > 0) {
        // Difference between this step and the previous one, as vectors:
        // a reversal at constant speed is a large acceleration.
        const change = step
          .clone()
          .divideScalar(spans[index])
          .sub(steps[index - 1].clone().divideScalar(spans[index - 1]))
          .length();
        const acceleration = change / ((spans[index] + spans[index - 1]) / 2);
        if (acceleration > T.acceleration.fail * factor)
          add(
            bone,
            "fail",
            from,
            to,
            acceleration,
            T.acceleration.fail * factor,
            "°/s²",
            "angular acceleration spike",
          );
        else if (acceleration > T.acceleration.warn * factor)
          add(
            bone,
            "warn",
            from,
            to,
            acceleration,
            T.acceleration.warn * factor,
            "°/s²",
            "angular acceleration spike",
          );
      }
    });
    findings.push(...findStalls(bone, times, steps, speeds));
  }
  return findings;
}

/**
 * Warn where a bone stops mid-motion: slow frames between faster motion that
 * continues in the same direction. Authored holds between opposite motions
 * (peaks) are natural and not reported.
 */
function findStalls(
  bone: string,
  times: readonly number[],
  steps: readonly Vector3[],
  speeds: readonly number[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  let index = 0;
  while (index < speeds.length) {
    if (speeds[index] >= T.stallSpeed) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < speeds.length && speeds[end + 1] < T.stallSpeed) end += 1;
    const duration = times[end + 1] - times[index];
    // Fastest motion within the look-around window on each side.
    const fastest = (from: number, to: number) => {
      let best = -1;
      for (let k = Math.max(from, 0); k <= Math.min(to, speeds.length - 1); k++)
        if (best < 0 || speeds[k] > speeds[best]) best = k;
      return best;
    };
    const window = Math.round(
      T.stallLookAround / Math.max(times[1] - times[0], 1e-6),
    );
    const before = index > 0 ? fastest(index - window, index - 1) : -1;
    const after = end + 1 < speeds.length ? fastest(end + 1, end + window) : -1;
    if (
      before >= 0 &&
      after >= 0 &&
      duration >= T.stallSeconds &&
      speeds[before] > T.stallMotionSpeed &&
      speeds[after] > T.stallMotionSpeed &&
      steps[before].clone().normalize().dot(steps[after].clone().normalize()) >
        0.7
    )
      findings.push({
        category: "smoothness",
        severity: "warn",
        avatar: null,
        subject: bone,
        from: times[index],
        to: times[end + 1],
        value: round(duration, 2),
        limit: T.stallSeconds,
        unit: "s",
        detail:
          "stops mid-motion and continues the same way (unintended stop?)",
      });
    index = end + 1;
  }
  return findings;
}

function checkLoopSeam(
  clip: AnimaPoseClip,
  duration: number,
  sampleRate: number,
): MotionCheckFinding[] {
  const linear = { ...clip, loop: false };
  const dt = 1 / sampleRate;
  const end = samplePose(linear, duration);
  const start = samplePose(clip, 0);
  const before = samplePose(linear, duration - dt);
  const after = samplePose(clip, dt);
  const findings: MotionCheckFinding[] = [];
  for (const bone of new Set([...Object.keys(end), ...Object.keys(start)])) {
    const name = bone as VRMHumanBoneName;
    const gap = angularDistanceDegrees(
      rotationOf(end, name),
      rotationOf(start, name),
    );
    if (gap > T.loopSeamDegrees) {
      findings.push({
        category: "loopSeam",
        severity: "fail",
        avatar: null,
        subject: bone,
        from: duration,
        to: duration,
        value: round(gap),
        limit: T.loopSeamDegrees,
        unit: "°",
        detail: "the loop end does not match its start",
      });
      continue;
    }
    // Velocity vectors on each side of the seam; a reversal or speed jump
    // shows as a large change.
    const velocityBefore = rotationStep(
      rotationOf(before, name),
      rotationOf(end, name),
    ).divideScalar(dt);
    const velocityAfter = rotationStep(
      rotationOf(start, name),
      rotationOf(after, name),
    ).divideScalar(dt);
    const acceleration = velocityAfter.sub(velocityBefore).length() / dt;
    const factor = /Thumb|Index|Middle|Ring|Little/.test(bone) ? 2 : 1;
    const severity =
      acceleration > T.acceleration.fail * factor
        ? "fail"
        : acceleration > T.acceleration.warn * factor
          ? "warn"
          : null;
    if (severity)
      findings.push({
        category: "loopSeam",
        severity,
        avatar: null,
        subject: bone,
        from: duration,
        to: duration,
        value: round(acceleration),
        limit: T.acceleration[severity] * factor,
        unit: "°/s²",
        detail: "velocity changes abruptly across the loop seam",
      });
  }
  return findings;
}

// ─── Per-Avatar rendered checks ────────────────────────────────────────────

const TRACKED_BONES: VRMHumanBoneName[] = [
  "hips",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  ...SIDES.flatMap((side) =>
    (
      [
        "UpperArm",
        "LowerArm",
        "Hand",
        "MiddleProximal",
        "MiddleIntermediate",
        "MiddleDistal",
        "UpperLeg",
        "Foot",
        "Toes",
      ] as const
    ).map((part) => `${side}${part}` as VRMHumanBoneName),
  ),
];

type Frame = Map<VRMHumanBoneName, Vector3>;

/** Rendered body measurements for one Avatar. */
class AvatarBody {
  readonly scale: number;
  private readonly vrm: VRM;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    applyCanonicalPose(vrm, {});
    const head = rawBoneWorldPosition(vrm, "head")!;
    const foot = rawBoneWorldPosition(vrm, "leftFoot")!;
    // Head-bone height relative to a 1.35 m reference Avatar.
    this.scale = (head.y - foot.y) / 1.35;
  }

  capture(pose: Pose): Frame {
    applyCanonicalPose(this.vrm, pose);
    const frame: Frame = new Map();
    for (const bone of TRACKED_BONES) {
      const position = rawBoneWorldPosition(this.vrm, bone);
      if (position) frame.set(bone, position);
    }
    return frame;
  }

  /**
   * Each compared bone's world rotation relative to its T-pose world rotation.
   * three-vrm's normalization makes these equal across correctly converted
   * rigs, whatever their raw bone orientations.
   */
  rotationsFromRest(
    pose: Pose,
    rest: Map<VRMHumanBoneName, Quaternion>,
  ): Map<string, Quaternion> {
    const current = this.rotations(pose);
    const result = new Map<string, Quaternion>();
    for (const bone of PARITY_BONES) {
      const now = current.get(bone);
      const then = rest.get(bone);
      if (now && then) result.set(bone, now.multiply(then.clone().invert()));
    }
    return result;
  }

  /** World rotations of raw bones under a canonical pose. */
  rotations(pose: Pose): Map<VRMHumanBoneName, Quaternion> {
    applyCanonicalPose(this.vrm, pose);
    const result = new Map<VRMHumanBoneName, Quaternion>();
    for (const [bone] of Object.entries(this.vrm.humanoid.humanBones)) {
      const node = this.vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName);
      if (node)
        result.set(
          bone as VRMHumanBoneName,
          node.getWorldQuaternion(new Quaternion()),
        );
    }
    return result;
  }

  position(bone: VRMHumanBoneName): Vector3 | null {
    return rawBoneWorldPosition(this.vrm, bone);
  }

  /** Approximate body volumes; radii scale with the Avatar's height. */
  capsules(frame: Frame): Record<string, Capsule> {
    const s = this.scale;
    const get = (bone: VRMHumanBoneName) => frame.get(bone)!;
    const head = get("head");
    const leftEye = frame.get("leftEye");
    const rightEye = frame.get("rightEye");
    // Without eye bones, approximate the eyes above and in front of the head joint.
    const eyes =
      leftEye && rightEye
        ? leftEye.clone().add(rightEye).multiplyScalar(0.5)
        : head.clone().add(new Vector3(0, 0.06 * s, 0.08 * s));
    const result: Record<string, Capsule> = {
      // The torso ends at the upper chest so the chin and throat stay clear.
      torso: {
        a: get("hips"),
        b: frame.get("upperChest") ?? get("chest"),
        radius: 0.13 * s,
      },
      neck: { a: get("neck"), b: head, radius: 0.05 * s },
      // Skull: from the head joint up through the eyes, turning with the head.
      head: {
        a: head.clone().lerp(eyes, 0.6),
        b: eyes.clone().add(eyes.clone().sub(head).multiplyScalar(0.4)),
        radius: 0.09 * s,
      },
    };
    for (const side of SIDES) {
      const tip = get(`${side}MiddleDistal`)
        .clone()
        .multiplyScalar(2)
        .sub(get(`${side}MiddleIntermediate`));
      result[`${side}Forearm`] = {
        a: get(`${side}LowerArm`),
        b: get(`${side}Hand`),
        radius: 0.035 * s,
      };
      result[`${side}Hand`] = {
        a: get(`${side}Hand`),
        b: tip,
        radius: 0.03 * s,
      };
    }
    return result;
  }
}

const INTERSECTION_PAIRS: readonly [string, string][] = [
  ...SIDES.flatMap((side) =>
    ["torso", "neck", "head"].flatMap((body) => [
      [`${side}Hand`, body] as [string, string],
      [`${side}Forearm`, body] as [string, string],
    ]),
  ),
  ["leftHand", "rightHand"],
  ["leftHand", "rightForearm"],
  ["rightHand", "leftForearm"],
];

function penetrations(capsules: Record<string, Capsule>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [first, second] of INTERSECTION_PAIRS) {
    const a = capsules[first];
    const b = capsules[second];
    result.set(
      `${first}/${second}`,
      a.radius + b.radius - segmentDistance(a.a, a.b, b.a, b.b),
    );
  }
  return result;
}

/** Map a contact bone to the body volume it belongs to. */
function contactVolume(bone: string): string | null {
  const side = bone.startsWith("left")
    ? "left"
    : bone.startsWith("right")
      ? "right"
      : null;
  if (side && /Hand|Thumb|Index|Middle|Ring|Little/.test(bone))
    return `${side}Hand`;
  if (side && /LowerArm/.test(bone)) return `${side}Forearm`;
  if (/head|neck|Eye|jaw/.test(bone)) return "head";
  if (/hips|spine|chest|Chest|Shoulder/.test(bone)) return "torso";
  return null;
}

function checkIntersections(
  avatar: string,
  times: readonly number[],
  frames: readonly Record<string, Capsule>[],
  rest: Map<string, number>,
  contacts: readonly MotionContact[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  frames.forEach((capsules, index) => {
    const time = times[index];
    const allowed = new Set(
      contacts
        .filter((contact) => time >= contact.from && time <= contact.to)
        .flatMap((contact) => {
          const a = contactVolume(contact.bone);
          const b = contactVolume(contact.target);
          if (!a || !b) return [];
          // Touching the face also reaches the neck and jaw line.
          const targets = b === "head" ? ["head", "neck"] : [b];
          return targets.flatMap((t) => [`${a}/${t}`, `${t}/${a}`]);
        }),
    );
    for (const [pair, depth] of penetrations(capsules)) {
      if (allowed.has(pair)) continue;
      const limit = Math.max(0, rest.get(pair) ?? 0) + T.intersectionMargin;
      if (depth > limit)
        findings.push({
          category: "intersection",
          severity: "fail",
          avatar,
          subject: pair,
          from: time,
          to: time,
          value: round(depth, 3),
          limit: round(limit, 3),
          unit: "m",
          detail: "body volumes overlap (approximate capsules)",
        });
    }
  });
  return findings;
}

function checkContacts(
  avatar: string,
  times: readonly number[],
  poses: readonly Pose[],
  body: AvatarBody,
  restRotations: Map<VRMHumanBoneName, Quaternion>,
  options: MotionCheckOptions,
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  for (const contact of options.contacts ?? []) {
    const tolerance = contact.tolerance ?? T.contactTolerance;
    const bone = contact.bone as VRMHumanBoneName;
    const target = contact.target as VRMHumanBoneName;
    times.forEach((time, index) => {
      if (time < contact.from - 1e-6 || time > contact.to + 1e-6) return;
      const rotations = body.rotations(poses[index]);
      const from = body.position(bone);
      const to = body.position(target);
      if (!from || !to) {
        findings.push({
          category: "contact",
          severity: "fail",
          avatar,
          subject: `${contact.bone}→${contact.target}`,
          from: time,
          to: time,
          value: 0,
          limit: 0,
          unit: "",
          detail: "the Avatar lacks a contact bone",
        });
        return;
      }
      const delta = (rotations.get(target) ?? new Quaternion()).multiply(
        (restRotations.get(target) ?? new Quaternion()).clone().invert(),
      );
      const offset = new Vector3(
        ...(contact.offset ?? [0, 0, 0]),
      ).applyQuaternion(delta);
      const distance = from.distanceTo(to.add(offset));
      if (distance > tolerance)
        findings.push({
          category: "contact",
          severity: "fail",
          avatar,
          subject: `${contact.bone}→${contact.target}`,
          from: time,
          to: time,
          value: round(distance, 3),
          limit: tolerance,
          unit: "m",
          detail: "declared contact is not reached",
        });
    });
  }
  return findings;
}

function checkFeet(
  avatar: string,
  times: readonly number[],
  frames: readonly Frame[],
  rest: Frame,
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  frames.forEach((frame, index) => {
    for (const side of SIDES)
      for (const part of ["Foot", "Toes"] as const) {
        const bone = `${side}${part}` as VRMHumanBoneName;
        const now = frame.get(bone);
        const then = rest.get(bone);
        if (!now || !then) continue;
        const slide = Math.hypot(now.x - then.x, now.z - then.z);
        const rise = now.y - then.y;
        const problems: [string, number, number][] = [];
        if (slide > T.footSlide) problems.push(["slides", slide, T.footSlide]);
        if (rise > T.footLift) problems.push(["lifts", rise, T.footLift]);
        if (-rise > T.footSink) problems.push(["sinks", -rise, T.footSink]);
        for (const [detail, value, limit] of problems)
          findings.push({
            category: "feet",
            severity: "fail",
            avatar,
            subject: `${bone} ${detail}`,
            from: times[index],
            to: times[index],
            value: round(value, 3),
            limit,
            unit: "m",
            detail: `planted foot ${detail}`,
          });
      }
  });
  return findings;
}

const PARITY_BONES: VRMHumanBoneName[] = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  ...SIDES.flatMap((side) =>
    (
      [
        "Shoulder",
        "UpperArm",
        "LowerArm",
        "Hand",
        "UpperLeg",
        "LowerLeg",
        "Foot",
        "IndexProximal",
        "ThumbProximal",
      ] as const
    ).map((part) => `${side}${part}` as VRMHumanBoneName),
  ),
];

/**
 * Compare each bone's world rotation from rest between every pair of Avatars.
 * Correct VRM 0/1 conversion makes them equal regardless of proportions; a
 * sign or basis error shows as a large difference on the affected bones.
 */
export function checkParity(
  times: readonly number[],
  rotations: Readonly<Record<string, readonly Map<string, Quaternion>[]>>,
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  const ids = Object.keys(rotations);
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      times.forEach((time, index) => {
        const a = rotations[ids[i]][index];
        const b = rotations[ids[j]][index];
        for (const [bone, rotation] of a) {
          const other = b.get(bone);
          if (!other) continue;
          const angle = angularDistanceDegrees(rotation, other);
          if (angle > T.parityDegrees)
            findings.push({
              category: "parity",
              severity: "fail",
              avatar: `${ids[i]}↔${ids[j]}`,
              subject: bone,
              from: time,
              to: time,
              value: round(angle),
              limit: T.parityDegrees,
              unit: "°",
              detail: "the bone turns differently on the two Avatars",
            });
        }
      });
  return findings;
}

// ─── Geometry and reporting ────────────────────────────────────────────────

/** Shortest distance between segments p1–q1 and p2–q2. */
export function segmentDistance(
  p1: Vector3,
  q1: Vector3,
  p2: Vector3,
  q2: Vector3,
): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denominator = a * e - b * b;
      s = denominator > 1e-12 ? clamp01((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const closest1 = p1.clone().addScaledVector(d1, s);
  const closest2 = p2.clone().addScaledVector(d2, t);
  return closest1.distanceTo(closest2);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Merge consecutive-frame findings of the same kind, keeping the worst value. */
function mergeFindings(
  findings: readonly MotionCheckFinding[],
  gap: number,
): MotionCheckFinding[] {
  const merged: MotionCheckFinding[] = [];
  const open = new Map<string, MotionCheckFinding>();
  const sorted = [...findings].sort((a, b) => a.from - b.from);
  for (const finding of sorted) {
    const key = [
      finding.category,
      finding.severity,
      finding.avatar,
      finding.subject,
      finding.detail,
    ].join("|");
    const current = open.get(key);
    if (current && finding.from - current.to <= gap) {
      current.to = Math.max(current.to, finding.to);
      if (Math.abs(finding.value) > Math.abs(current.value))
        current.value = finding.value;
    } else {
      const copy = { ...finding };
      merged.push(copy);
      open.set(key, copy);
    }
  }
  return merged.sort(
    (a, b) =>
      (a.severity === "fail" ? 0 : 1) - (b.severity === "fail" ? 0 : 1) ||
      a.from - b.from,
  );
}

/** One line per finding, failures first. */
export function formatMotionCheckReport(report: MotionCheckReport): string {
  if (report.findings.length === 0) return "All motion checks passed.";
  const lines = report.findings.map((finding) => {
    const when =
      finding.from === finding.to
        ? `${finding.from.toFixed(2)}s`
        : `${finding.from.toFixed(2)}–${finding.to.toFixed(2)}s`;
    const who = ` [${finding.avatar ?? "canonical"}]`;
    return `${finding.severity.toUpperCase()} ${finding.category}${who} ${finding.subject} at ${when}: ${finding.detail} (${finding.value}${finding.unit}, limit ${finding.limit}${finding.unit})`;
  });
  const failures = report.findings.filter((f) => f.severity === "fail").length;
  lines.push(
    `${failures} failure(s), ${report.findings.length - failures} warning(s).`,
  );
  return lines.join("\n");
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
