import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Object3D, Quaternion, Vector3 } from "three";

import {
  getAnimaPoseClipTimelineDuration,
  parseAnimaPoseClip,
  type AnimaPoseClipV2,
} from "../poses/animaPoseClip";
import type { AnimaPoseClipMutableLayerId } from "../poses/animaPoseClip/clipVocabulary";
import {
  createAnimaPoseClipProgram,
  type AnimaPoseClipProgram,
} from "../poses/animaPoseClip/program";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../poses/catalog";
import {
  JOINT_DEFINITIONS,
  JOINT_IDS,
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
  type JointComponentDefinition,
  type Side,
} from "../poses/anatomy/anatomy";
import {
  CanonicalSkeleton,
  FINGER_BONE,
  HAND_BONE,
  HAND_OR_FINGER_BONE,
  avatarScale,
  type ContactPoint,
} from "../poses/anatomy/arms";
import { applyCanonicalPose } from "./kinematics";

/**
 * Automated motion checks for an agent-authored or hand-made Gesture clip.
 *
 * Checks play the clip through the production sampler on each loaded Avatar
 * (2.0 clips prepared for that Avatar, as at runtime) and report plausibility
 * problems. They cannot establish natural-looking motion; they catch anatomy,
 * continuity, rhythm, collision, contact and grounding mistakes.
 */

export type MotionCheckCategory =
  | "pose"
  | "range"
  | "smoothness"
  | "oscillation"
  | "intersection"
  | "fingers"
  | "contact"
  | "feet"
  | "loopSeam"
  | "parity";

export type MotionCheckFinding = {
  category: MotionCheckCategory;
  severity: "fail" | "warn";
  /**
   * Avatar id, or null for checks on the canonical clip values that every
   * Avatar shares (range, smoothness, oscillation, loop seam, unresolved
   * poses). Range and smoothness of an arm that a solved contact moves are
   * also reported per Avatar after the first.
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
  /**
   * Contacts only: where the contact point actually is relative to the target
   * point, in the target's rest-aligned frame, in metres at the reference
   * height (divided by the Avatar's scale). Usable directly as `offset`.
   */
  actualOffset?: [number, number, number];
};

export type MotionCheckReport = {
  ok: boolean;
  findings: MotionCheckFinding[];
  sampleRate: number;
};

export type MotionCheckAvatar = { id: string; vrm: VRM };

/** An intended touch, in seconds from the clip's start. */
export type MotionCheckContact = {
  /** Humanoid bone that should touch, for example `rightIndexDistal`. */
  bone: string;
  /** Where on `bone` (default `joint`; `tip` on fingers, `palm` on hands). */
  point?: ContactPoint;
  /** Humanoid bone it touches, for example `head`. */
  target: string;
  /** Where on `target` (default `joint`). */
  targetPoint?: ContactPoint;
  /**
   * Offset from the target point in the target's rest-aligned frame, metres
   * at the reference height (x left, y up, z forward); scaled per Avatar.
   */
  offset?: [number, number, number];
  from: number;
  to: number;
  /** Allowed distance, metres. Defaults to `contactTolerance`. */
  tolerance?: number;
  /** Also check that the palm of `bone`'s hand faces the target. */
  facing?: boolean;
};

export type MotionCheckOptions = {
  /**
   * Contacts to check besides those a 2.0 clip declares. Playback does not
   * solve them; they are measured like unsolved clip contacts.
   */
  contacts?: readonly MotionCheckContact[];
  /**
   * Check that feet stay at their base-pose positions. Defaults to true
   * unless a 2.0 clip keys its legs itself without `plantFeet`.
   */
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
  /**
   * Rapid oscillation (WARN): one joint component swings back and forth for
   * at least `cycles` cycles (that many peaks and troughs: 2 × `cycles`
   * reversals in a row, each swing at least `amplitude` degrees) faster than
   * `frequency` Hz, timed over whole cycles from peak to peak and trough to
   * trough. Calm laughs and bounces pulse at 2.5–3.3 Hz; 4 Hz and above
   * reads as shivering. Small tremors below the amplitude are ignored, and
   * eyes, fingers and toes are not measured (darts and wiggles may be fast).
   */
  oscillation: { frequency: 4, amplitude: 1.5, cycles: 3 },
  /** Penetration beyond the base pose's own, metres. */
  intersectionMargin: 0.015,
  /**
   * Finger capsules, as multiples of the Avatar's finger spacing (mean
   * distance between neighbouring finger bases): finger, thumb and palm
   * radii. A pair WARNs when its axes come closer than `warnFraction` of the
   * two radii together (the volumes overlap by more than half). Within one
   * hand it FAILs below `failFraction` (a finger passes through); between the
   * two hands, whose placement differs with each Avatar's arms, it only warns.
   */
  fingers: {
    fingerRadius: 0.45,
    thumbRadius: 0.5,
    palmRadius: 0.75,
    warnFraction: 0.5,
    failFraction: 0.2,
  },
  /** Feet: horizontal slide, lift and sink from the base pose. */
  footSlide: 0.02,
  footLift: 0.015,
  footSink: 0.015,
  /** Loop seam angle, degrees. */
  loopSeamDegrees: 0.5,
  /** Disagreement between Avatars in a bone's world rotation from rest, degrees. */
  parityDegrees: 10,
  contactTolerance: 0.06,
  /**
   * A solved contact's tolerance is at most this: the solver lands the point
   * exactly when the Avatar can reach it.
   */
  solvedContactTolerance: 0.015,
  /**
   * WARN when a solved contact's authored (unsolved) point is farther than
   * this from its target at full weight (metres at the reference height):
   * the solver, not the authored arm, is doing the reach.
   */
  reachCorrection: 0.08,
  /** WARN when a `facing` palm turns further than this from its target, degrees. */
  facingDegrees: 45,
} as const;

type Pose = VRMPose;
type Capsule = { a: Vector3; b: Vector3; radius: number };
/** A contact as checked: solved when the clip declares `solve` for it. */
type CheckedContact = MotionCheckContact & { solved: boolean };

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
  const duration = getAnimaPoseClipTimelineDuration(clip);
  const times: number[] = [];
  for (let index = 0; index * (1 / sampleRate) < duration - 1e-9; index += 1)
    times.push(index / sampleRate);
  times.push(duration);
  const contacts: CheckedContact[] = [
    ...clipContacts(clip),
    ...(options.contacts ?? []).map((contact) => ({
      ...contact,
      solved: false,
    })),
  ];
  // Feet should stay put unless the clip moves its legs itself.
  const plantFeet =
    options.plantFeet ?? (clip.plantFeet === true || !keysLegs(clip));
  // Each Avatar plays its own preparation (fitted hands, solved legs and
  // contacts). Checks on canonical values use the first Avatar's.
  const programs = avatars.map(({ vrm }) =>
    createAnimaPoseClipProgram(clip, { vrm, resolvePose: resolveCatalogPose }),
  );
  // Arms that solved contacts move differ per Avatar by design, so parity
  // and the reach-correction warning read the authored (unsolved) arms.
  const solvedSides = new Set(
    contacts.flatMap((contact) =>
      contact.solved ? [handSideOf(contact.bone)!] : [],
    ),
  );
  const unsolvedPrograms =
    solvedSides.size > 0
      ? avatars.map(({ vrm }) =>
          createAnimaPoseClipProgram(clip, {
            vrm,
            resolvePose: resolveCatalogPose,
            solveContacts: false,
          }),
        )
      : programs;
  const canonical =
    programs[0] ??
    createAnimaPoseClipProgram(clip, { resolvePose: resolveCatalogPose });
  const missingPoseRefs = new Set<string>();
  const samplesOf = (program: AnimaPoseClipProgram) =>
    times.map((time) => samplePose(program, time, missingPoseRefs));
  const canonicalPoses = samplesOf(canonical);
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
    ...checkRanges(times, canonicalPoses),
    ...checkSmoothness(times, canonicalPoses),
    ...checkOscillation(times, canonicalPoses),
    ...(clip.loop ? checkLoopSeam(canonical, duration, sampleRate) : []),
    ...checkSolvedHeadContacts(contacts, clip.mutedProceduralLayers ?? []),
  ];
  // The canonical pass sees only the first Avatar's solve; solved arms get
  // range and smoothness on every other Avatar too.
  const solvedArmBones = new Set<string>(
    [...solvedSides].flatMap((side) => [`${side}UpperArm`, `${side}LowerArm`]),
  );
  const rotationsFromRest: Record<string, Map<string, Quaternion>[]> = {};
  for (const [index, avatar] of avatars.entries()) {
    const avatarPoses =
      index === 0 ? canonicalPoses : samplesOf(programs[index]);
    const body = new AvatarBody(avatar.vrm);
    const restFrame = body.capture(base);
    const restPenetration = penetrations(body.capsules(restFrame));
    const frames = avatarPoses.map((pose) => body.capture(pose));
    const unsolvedFrames =
      unsolvedPrograms === programs
        ? frames
        : samplesOf(unsolvedPrograms[index]).map((pose) => body.capture(pose));
    rotationsFromRest[avatar.id] = unsolvedFrames.map((frame) =>
      body.rotationsFromRest(frame),
    );
    raw.push(
      ...checkIntersections(
        avatar.id,
        times,
        frames.map((frame) => body.capsules(frame)),
        restPenetration,
        contacts,
      ),
      ...checkFingers(avatar.id, times, frames, body, contacts),
      ...checkContacts(
        avatar.id,
        times,
        frames,
        unsolvedFrames,
        body,
        contacts,
      ),
      ...(plantFeet ? checkFeet(avatar.id, times, frames, restFrame) : []),
      ...(index > 0 && solvedArmBones.size > 0
        ? [
            ...checkRanges(times, avatarPoses, {
              avatar: avatar.id,
              joints: solvedArmBones,
            }),
            ...checkSmoothness(times, avatarPoses, {
              avatar: avatar.id,
              bones: solvedArmBones,
            }),
          ]
        : []),
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

const LEG_BONE = /^(left|right)(UpperLeg|LowerLeg|Foot|Toes)$/;

/** Whether a 2.0 clip keys any leg bone itself (instead of planting feet). */
function keysLegs(clip: AnimaPoseClipV2): boolean {
  return [
    ...Object.keys(clip.joints ?? {}),
    ...Object.keys(clip.rotations ?? {}),
  ].some((bone) => LEG_BONE.test(bone));
}

/** A clip's declared contacts, in seconds from its start. */
function clipContacts(clip: AnimaPoseClipV2): CheckedContact[] {
  const beatTimes = new Map(clip.beats.map(({ id, time }) => [id, time]));
  return (clip.contacts ?? []).map((contact) => {
    const time = beatTimes.get(contact.beat) ?? 0;
    return {
      bone: contact.bone,
      target: contact.target,
      from: time + contact.from,
      to: time + contact.to,
      ...(contact.point ? { point: contact.point } : {}),
      ...(contact.targetPoint ? { targetPoint: contact.targetPoint } : {}),
      ...(contact.offset ? { offset: contact.offset } : {}),
      ...(contact.tolerance !== undefined
        ? { tolerance: contact.tolerance }
        : {}),
      ...(contact.facing ? { facing: true } : {}),
      solved: contact.solve !== undefined,
    };
  });
}

/** The side of a hand or finger bone, or null for any other bone. */
function handSideOf(bone: string): Side | null {
  return (HAND_OR_FINGER_BONE.exec(bone)?.[1] as Side | undefined) ?? null;
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
  program: AnimaPoseClipProgram,
  time: number,
  missingPoseRefs?: Set<string>,
  options?: { atEnd?: boolean },
): Pose {
  const result = program.sample(time, options);
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

/**
 * Which poses a range or smoothness pass reports on: the canonical values
 * (`avatar` null, every joint) or one Avatar's solved arms.
 */
type CheckScope = { avatar: string | null; joints?: ReadonlySet<string> };

function checkRanges(
  times: readonly number[],
  poses: readonly Pose[],
  { avatar, joints }: CheckScope = { avatar: null },
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  const ids = joints ? JOINT_IDS.filter((id) => joints.has(id)) : JOINT_IDS;
  poses.forEach((pose, index) => {
    for (const id of ids) {
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
          avatar,
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
  {
    avatar,
    bones: only,
  }: { avatar: string | null; bones?: ReadonlySet<string> } = {
    avatar: null,
  },
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  const bones = new Set<VRMHumanBoneName>();
  for (const pose of poses)
    for (const bone of Object.keys(pose))
      if (!only || only.has(bone)) bones.add(bone as VRMHumanBoneName);
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
      avatar,
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
    findings.push(...findStalls(bone, avatar, times, steps, speeds));
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
  avatar: string | null,
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
        avatar,
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

/** Joints whose components the oscillation check reads (not eyes, fingers or toes). */
const OSCILLATION_JOINTS = JOINT_IDS.filter(
  (id) => !/^eyes$|Thumb|Index|Middle|Ring|Little|Toes/.test(id),
);

/**
 * Warn where a joint component swings back and forth faster than about 4 Hz
 * for three cycles or more (`MOTION_CHECK_THRESHOLDS.oscillation`).
 *
 * Reversals are the turning points of the component's curve, keeping only
 * swings of at least the amplitude (a zig-zag filter), timed to a fraction of
 * a frame by a parabola through the samples around each turn; where the
 * motion starts is not a reversal. Every six reversals in a row (three peaks
 * and three troughs) are rated by the time between like reversals: first to
 * fifth (peak to peak, or trough to trough) and second to sixth, two full
 * cycles each. Whole cycles hold one quick and one slow swing each, so an
 * uneven pulse (a quick rise and a slower fall) counts at its true cycle rate.
 * Overlapping fast windows are reported as one stretch, with the fastest
 * window's rate.
 */
export function checkOscillation(
  times: readonly number[],
  poses: readonly Pose[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  for (const id of OSCILLATION_JOINTS) {
    const joint = resolveJoint(id)!;
    const names = Object.keys(JOINT_DEFINITIONS[joint.type].components);
    const series: Record<string, (number | null)[]> = Object.fromEntries(
      names.map((name) => [name, []]),
    );
    let previous: Record<string, number> | undefined;
    for (const pose of poses) {
      // Near the previous frame, so a value never jumps Euler branches.
      const values = decomposeJointRotation(
        joint,
        rotationOf(pose, joint.bones[0]),
        previous,
      );
      previous = values;
      for (const name of names)
        series[name].push(
          joint.type === "upperArm" &&
            name !== "elevation" &&
            values.elevation < T.armDegenerateElevation
            ? null // A hanging arm's plane and rotation are undefined.
            : values[name],
        );
    }
    for (const name of names)
      findings.push(...oscillationRuns(`${id}.${name}`, times, series[name]));
  }
  return findings;
}

function oscillationRuns(
  subject: string,
  times: readonly number[],
  values: readonly (number | null)[],
): MotionCheckFinding[] {
  const { frequency, amplitude, cycles } = T.oscillation;
  const reversalsNeeded = 2 * cycles;
  const findings: MotionCheckFinding[] = [];
  // Each stretch of defined values is measured on its own.
  let start = 0;
  while (start < values.length) {
    if (values[start] === null) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < values.length && values[end + 1] !== null) end += 1;
    const span = values.slice(start, end + 1) as number[];
    const spanTimes = times.slice(start, end + 1);
    // The first turn is where the first swing starts, not a reversal.
    const reversals = turningPoints(span, amplitude)
      .slice(1)
      .map((index) => turnTime(spanTimes, span, index));
    // Cycle rate of each window of `reversalsNeeded` reversals starting
    // there: like reversals `reversalsNeeded − 2` apart span `cycles − 1`
    // whole cycles; the window's first and second such spans are averaged.
    const rates = reversals
      .slice(0, Math.max(0, reversals.length - reversalsNeeded + 1))
      .map(
        (time, index) =>
          (2 * (cycles - 1)) /
          (reversals[index + reversalsNeeded - 2] -
            time +
            reversals[index + reversalsNeeded - 1] -
            reversals[index + 1]),
      );
    let first = 0;
    while (first < rates.length) {
      if (!(rates[first] > frequency)) {
        first += 1;
        continue;
      }
      let last = first;
      while (last + 1 < rates.length && rates[last + 1] > frequency) last += 1;
      const count = last - first + reversalsNeeded;
      findings.push({
        category: "oscillation",
        severity: "warn",
        avatar: null,
        subject,
        from: reversals[first],
        to: reversals[last + reversalsNeeded - 1],
        value: round(Math.max(...rates.slice(first, last + 1))),
        limit: frequency,
        unit: "Hz",
        detail: `${Math.floor(count / 2)} cycles back and forth (${count} reversals) faster than ${frequency} Hz (rapid oscillation)`,
      });
      first = last + 1;
    }
    start = end + 1;
  }
  return findings;
}

/**
 * Indices of a curve's turning points with swings of at least `amplitude`
 * between them: the first is where the first such swing starts; the last
 * extreme, not followed by a reversal, is left out.
 */
function turningPoints(values: readonly number[], amplitude: number): number[] {
  const turns: number[] = [];
  let low = 0;
  let high = 0;
  let direction = 0;
  let extreme = 0;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (direction === 0) {
      if (value < values[low]) low = index;
      if (value > values[high]) high = index;
      if (values[high] - values[low] >= amplitude) {
        // The earlier extreme starts the first swing.
        turns.push(Math.min(low, high));
        direction = low < high ? 1 : -1;
        extreme = Math.max(low, high);
      }
    } else if (direction > 0) {
      if (value > values[extreme]) extreme = index;
      else if (values[extreme] - value >= amplitude) {
        turns.push(extreme);
        direction = -1;
        extreme = index;
      }
    } else if (value < values[extreme]) extreme = index;
    else if (value - values[extreme] >= amplitude) {
      turns.push(extreme);
      direction = 1;
      extreme = index;
    }
  }
  return turns;
}

/**
 * The time of a turning point: the middle of a flat top, or the vertex of the
 * parabola through the sample and its neighbours (sub-frame accuracy).
 */
function turnTime(
  times: readonly number[],
  values: readonly number[],
  index: number,
): number {
  let first = index;
  let last = index;
  while (first > 0 && Math.abs(values[first - 1] - values[index]) < 1e-6)
    first -= 1;
  while (
    last < values.length - 1 &&
    Math.abs(values[last + 1] - values[index]) < 1e-6
  )
    last += 1;
  if (last > first) return (times[first] + times[last]) / 2;
  if (index === 0 || index === values.length - 1) return times[index];
  const [before, at, after] = [
    values[index - 1],
    values[index],
    values[index + 1],
  ];
  const curvature = before - 2 * at + after;
  if (Math.abs(curvature) < 1e-12) return times[index];
  const shift = Math.min(
    0.5,
    Math.max(-0.5, (0.5 * (before - after)) / curvature),
  );
  return (
    times[index] +
    shift *
      (shift < 0
        ? times[index] - times[index - 1]
        : times[index + 1] - times[index])
  );
}

function checkLoopSeam(
  program: AnimaPoseClipProgram,
  duration: number,
  sampleRate: number,
): MotionCheckFinding[] {
  const dt = 1 / sampleRate;
  const end = samplePose(program, duration, undefined, { atEnd: true });
  const start = samplePose(program, 0);
  const before = samplePose(program, duration - dt);
  const after = samplePose(program, dt);
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

/**
 * Live layers that turn the head or neck after the clip, so a hand solved onto
 * the head drifts: every mutable layer except breathing, whose millimetres are
 * accepted.
 */
const HEAD_MOVING_LAYERS: readonly AnimaPoseClipMutableLayerId[] = [
  "sway",
  "bounce",
  "headNod",
  "headSideTilt",
  "cursorLookAt",
  "emotionPosture",
];
const HEAD_TARGET = /^(head|neck|jaw|leftEye|rightEye)$/;

/**
 * Warn about a solved contact on the head or neck while a live layer that
 * moves the head stays on: the layers run after the clip, so the hand would
 * land where the head was and the head would move away from it.
 */
function checkSolvedHeadContacts(
  contacts: readonly CheckedContact[],
  muted: readonly AnimaPoseClipMutableLayerId[],
): MotionCheckFinding[] {
  const unmuted = HEAD_MOVING_LAYERS.filter((layer) => !muted.includes(layer));
  if (unmuted.length === 0) return [];
  return contacts
    .filter((contact) => contact.solved && HEAD_TARGET.test(contact.target))
    .map((contact) => ({
      category: "contact",
      severity: "warn",
      avatar: null,
      subject: `${contact.bone}→${contact.target}`,
      from: contact.from,
      to: contact.to,
      value: unmuted.length,
      limit: 0,
      unit: " layers",
      detail: `solved head contact while live layers move the head after the clip; mute ${unmuted.join(", ")}`,
    }));
}

// ─── Per-Avatar rendered checks ────────────────────────────────────────────

/** Raw (skinned) bone world positions and rotations under one pose. */
type Frame = {
  positions: Map<VRMHumanBoneName, Vector3>;
  rotations: Map<VRMHumanBoneName, Quaternion>;
};

const FINGER_DIGITS = ["Index", "Middle", "Ring", "Little"] as const;
/** Checked finger segments per digit; the thumb metacarpal lies in the palm. */
const DIGIT_SEGMENTS = {
  Thumb: ["ThumbProximal", "ThumbDistal"],
  Index: ["IndexProximal", "IndexIntermediate", "IndexDistal"],
  Middle: ["MiddleProximal", "MiddleIntermediate", "MiddleDistal"],
  Ring: ["RingProximal", "RingIntermediate", "RingDistal"],
  Little: ["LittleProximal", "LittleIntermediate", "LittleDistal"],
} as const;
type Digit = keyof typeof DIGIT_SEGMENTS;

/** One finger segment's capsule, from its joint to the next joint or the tip. */
type FingerSegment = {
  digit: Digit;
  bone: VRMHumanBoneName;
  radius: number;
  /** Checked against its own palm (not proximal finger segments, which join it). */
  againstPalm: boolean;
};
/** One hand's finger and palm capsules, sized from the rig. */
type HandCapsules = {
  side: Side;
  segments: FingerSegment[];
  /** Palm capsules run from the wrist to each of these finger bases. */
  palmBases: VRMHumanBoneName[];
  palmRadius: number;
};

const scratchScale = new Vector3();

/** Rendered body measurements for one Avatar. */
class AvatarBody {
  /** Head-bone height over a 1.35 m reference: sizes the body capsules. */
  readonly scale: number;
  /** `avatarScale`: contact offsets (authored at 1.25 m) are multiplied by it. */
  readonly contactScale: number;
  readonly skeleton: CanonicalSkeleton;
  readonly hands: Partial<Record<Side, HandCapsules>>;
  private readonly vrm: VRM;
  private readonly nodes: [VRMHumanBoneName, Object3D][];
  private readonly restRotations: Map<VRMHumanBoneName, Quaternion>;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.nodes = Object.keys(vrm.humanoid.humanBones).flatMap((bone) => {
      const node = vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName);
      return node ? [[bone as VRMHumanBoneName, node] as const] : [];
    }) as [VRMHumanBoneName, Object3D][];
    const rest = this.capture({});
    this.restRotations = rest.rotations;
    const head = rest.positions.get("head")!;
    const foot = rest.positions.get("leftFoot")!;
    // Head-bone height relative to a 1.35 m reference Avatar.
    this.scale = (head.y - foot.y) / 1.35;
    this.skeleton = new CanonicalSkeleton(vrm);
    this.contactScale = avatarScale(this.skeleton);
    this.hands = {};
    for (const side of SIDES) {
      const hand = this.handCapsules(side);
      if (hand) this.hands[side] = hand;
    }
  }

  /** Pose the Avatar and read every raw humanoid bone's world transform. */
  capture(pose: Pose): Frame {
    // Updates every world matrix, so they can be read directly below.
    applyCanonicalPose(this.vrm, pose);
    const positions = new Map<VRMHumanBoneName, Vector3>();
    const rotations = new Map<VRMHumanBoneName, Quaternion>();
    for (const [bone, node] of this.nodes) {
      const position = new Vector3();
      const rotation = new Quaternion();
      node.matrixWorld.decompose(position, rotation, scratchScale);
      positions.set(bone, position);
      rotations.set(bone, rotation);
    }
    return { positions, rotations };
  }

  /**
   * A bone's world rotation from its T-pose world rotation: its rest-aligned
   * frame, which equals the canonical world rotation contact points use.
   */
  delta(frame: Frame, bone: VRMHumanBoneName): Quaternion {
    return (frame.rotations.get(bone) ?? new Quaternion())
      .clone()
      .multiply(
        (this.restRotations.get(bone) ?? new Quaternion()).clone().invert(),
      );
  }

  /** World position of a contact point, or null when the rig lacks the bone. */
  point(
    frame: Frame,
    bone: VRMHumanBoneName,
    point: ContactPoint | undefined,
  ): Vector3 | null {
    const position = frame.positions.get(bone);
    const offset = this.skeleton.pointOffset(bone, point);
    if (!position || !offset) return null;
    return offset
      .clone()
      .applyQuaternion(this.delta(frame, bone))
      .add(position);
  }

  /**
   * Each compared bone's world rotation relative to its T-pose world rotation.
   * three-vrm's normalization makes these equal across correctly converted
   * rigs, whatever their raw bone orientations.
   */
  rotationsFromRest(frame: Frame): Map<string, Quaternion> {
    const result = new Map<string, Quaternion>();
    for (const bone of PARITY_BONES)
      if (frame.rotations.has(bone) && this.restRotations.has(bone))
        result.set(bone, this.delta(frame, bone));
    return result;
  }

  /** Approximate body volumes; radii scale with the Avatar's height. */
  capsules(frame: Frame): Record<string, Capsule> {
    const s = this.scale;
    const get = (bone: VRMHumanBoneName) => frame.positions.get(bone)!;
    const head = get("head");
    const leftEye = frame.positions.get("leftEye");
    const rightEye = frame.positions.get("rightEye");
    // Without eye bones, approximate the eyes above and in front of the head joint.
    const eyes =
      leftEye && rightEye
        ? leftEye.clone().add(rightEye).multiplyScalar(0.5)
        : head.clone().add(new Vector3(0, 0.06 * s, 0.08 * s));
    const result: Record<string, Capsule> = {
      // The torso ends at the upper chest so the chin and throat stay clear.
      torso: {
        a: get("hips"),
        b: frame.positions.get("upperChest") ?? get("chest"),
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

  /**
   * A hand's centre on its bone line: halfway from the wrist to the base of
   * the middle finger (or the nearest finger the rig has).
   */
  handCentre(frame: Frame, side: Side): Vector3 | null {
    const wrist = frame.positions.get(`${side}Hand`);
    if (!wrist) return null;
    const base = (["Middle", "Ring", "Index", "Little"] as const)
      .map((digit) => frame.positions.get(`${side}${digit}Proximal`))
      .find(Boolean);
    return base ? wrist.clone().lerp(base, 0.5) : wrist.clone();
  }

  /**
   * Finger capsules from rig proportions, or null for a hand with fewer than
   * two finger bases (no spacing to size them from).
   */
  private handCapsules(side: Side): HandCapsules | null {
    const bases = FINGER_DIGITS.map(
      (digit) => `${side}${digit}Proximal` as VRMHumanBoneName,
    ).filter((bone) => this.skeleton.has(bone));
    if (bases.length < 2) return null;
    let spacing = 0;
    for (let index = 1; index < bases.length; index += 1)
      spacing += this.skeleton
        .restPosition(bases[index])!
        .distanceTo(this.skeleton.restPosition(bases[index - 1])!);
    spacing /= bases.length - 1;
    const segments: FingerSegment[] = [];
    for (const [digit, bones] of Object.entries(DIGIT_SEGMENTS) as [
      Digit,
      readonly string[],
    ][])
      bones.forEach((name, index) => {
        const bone = `${side}${name}` as VRMHumanBoneName;
        if (!this.skeleton.has(bone)) return;
        segments.push({
          digit,
          bone,
          radius:
            spacing *
            (digit === "Thumb"
              ? T.fingers.thumbRadius
              : T.fingers.fingerRadius),
          againstPalm: digit === "Thumb" || index > 0,
        });
      });
    return {
      side,
      segments,
      palmBases: bases,
      palmRadius: spacing * T.fingers.palmRadius,
    };
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
  contacts: readonly MotionCheckContact[],
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

/** A hand part the finger check names: a digit (`rightIndex`) or a palm (`rightPalm`). */
function fingerPart(bone: string): string | null {
  const match = HAND_OR_FINGER_BONE.exec(bone);
  if (!match) return null;
  return `${match[1]}${match[2] === "Hand" ? "Palm" : match[2]}`;
}

/** A placed finger or palm capsule and the hand part it belongs to. */
type PartCapsule = Capsule & { part: string; againstPalm: boolean };
/** One hand's capsules on a frame, with a bounding sphere about the wrist. */
type PlacedHand = {
  fingers: PartCapsule[];
  palm: PartCapsule[];
  wrist: Vector3;
  reach: number;
};

/**
 * Finger collisions on one Avatar: a finger through another finger of the
 * same hand, through its own palm, or through any part of the other hand.
 *
 * Each finger segment is a capsule from its joint to the next joint (the last
 * to its tip) and the palm a fan of capsules from the wrist to each finger
 * base, sized from the rig's finger spacing (`MOTION_CHECK_THRESHOLDS.fingers`).
 * Proximal finger segments are not checked against their own palm (they join
 * it), and the thumb not against the fingers of its own hand: fitted shapes
 * (fist, point, peace, pinch, OK) press it onto them by design. A declared
 * contact allows the parts it names while it lasts: two digits, or a digit
 * and its palm, of one hand; any parts of the two hands for a hand-to-hand
 * contact. Overlaps between the two hands only warn.
 */
function checkFingers(
  avatar: string,
  times: readonly number[],
  frames: readonly Frame[],
  body: AvatarBody,
  contacts: readonly MotionCheckContact[],
): MotionCheckFinding[] {
  const hands = SIDES.flatMap((side) => body.hands[side] ?? []);
  const findings: MotionCheckFinding[] = [];
  frames.forEach((frame, index) => {
    const time = times[index];
    const named = contacts
      .filter(
        (contact) => time >= contact.from - 1e-6 && time <= contact.to + 1e-6,
      )
      .flatMap((contact) => {
        const bone = fingerPart(contact.bone);
        const target = fingerPart(contact.target);
        return bone && target ? [[bone, target]] : [];
      });
    const allowed = (a: string, b: string) =>
      named.some(([bone, target]) =>
        a.startsWith("left") !== b.startsWith("left")
          ? bone.startsWith("left") !== target.startsWith("left")
          : (bone === a && target === b) || (bone === b && target === a),
      );
    const placed = new Map<Side, PlacedHand>();
    for (const hand of hands) {
      const wrist = frame.positions.get(`${hand.side}Hand`);
      if (!wrist) continue;
      const fingers = hand.segments.flatMap((segment): PartCapsule[] => {
        const a = frame.positions.get(segment.bone);
        const b = body.point(frame, segment.bone, "tip");
        return a && b
          ? [
              {
                a,
                b,
                radius: segment.radius,
                part: `${hand.side}${segment.digit}`,
                againstPalm: segment.againstPalm,
              },
            ]
          : [];
      });
      const palm = hand.palmBases.flatMap((bone): PartCapsule[] => {
        const base = frame.positions.get(bone);
        return base
          ? [
              {
                a: wrist,
                b: base,
                radius: hand.palmRadius,
                part: `${hand.side}Palm`,
                againstPalm: false,
              },
            ]
          : [];
      });
      let reach = 0;
      for (const capsule of [...fingers, ...palm])
        reach = Math.max(
          reach,
          capsule.b.distanceTo(wrist) + capsule.radius,
          capsule.a.distanceTo(wrist) + capsule.radius,
        );
      placed.set(hand.side, { fingers, palm, wrist, reach });
    }

    // The deepest overlap per pair of parts in this frame, relative to the
    // two radii.
    const worst = new Map<
      string,
      { distance: number; sum: number; detail: string; sameHand: boolean }
    >();
    const test = (a: PartCapsule, b: PartCapsule, detail: string) => {
      const sum = a.radius + b.radius;
      const distance = segmentDistance(a.a, a.b, b.a, b.b);
      if (distance >= T.fingers.warnFraction * sum) return;
      const subject = [a.part, b.part].sort(partOrder).join("/");
      const current = worst.get(subject);
      if (!current || distance / sum < current.distance / current.sum)
        worst.set(subject, {
          distance,
          sum,
          detail,
          sameHand: a.part.startsWith("left") === b.part.startsWith("left"),
        });
    };
    for (const [side, { fingers, palm }] of placed) {
      for (let i = 0; i < fingers.length; i += 1)
        for (let j = i + 1; j < fingers.length; j += 1) {
          const [a, b] = [fingers[i], fingers[j]];
          if (
            a.part === b.part ||
            a.part.endsWith("Thumb") ||
            b.part.endsWith("Thumb") ||
            allowed(a.part, b.part)
          )
            continue;
          test(a, b, "fingers pass through each other");
        }
      for (const finger of fingers)
        if (finger.againstPalm && !allowed(finger.part, `${side}Palm`))
          for (const capsule of palm)
            test(finger, capsule, "a finger passes through its palm");
    }
    const left = placed.get("left");
    const right = placed.get("right");
    if (
      left &&
      right &&
      left.wrist.distanceTo(right.wrist) < left.reach + right.reach &&
      !allowed("leftPalm", "rightPalm")
    ) {
      for (const finger of left.fingers)
        for (const capsule of [...right.fingers, ...right.palm])
          test(finger, capsule, "a finger passes through the other hand");
      for (const finger of right.fingers)
        for (const capsule of left.palm)
          test(finger, capsule, "a finger passes through the other hand");
    }

    for (const [subject, { distance, sum, detail, sameHand }] of worst) {
      // Between the hands the overlap depends on each Avatar's arm
      // proportions, so it only warns; a hand's own shape fails.
      const severity =
        sameHand && distance < T.fingers.failFraction * sum ? "fail" : "warn";
      const fraction =
        severity === "fail" ? T.fingers.failFraction : T.fingers.warnFraction;
      findings.push({
        category: "fingers",
        severity,
        avatar,
        subject,
        from: time,
        to: time,
        // Overlap depth of the two capsules: deeper is worse.
        value: round(sum - distance, 3),
        limit: round((1 - fraction) * sum, 3),
        unit: "m",
        detail: `${detail} (finger capsules)`,
      });
    }
  });
  return findings;
}

const PART_ORDER = ["Thumb", "Index", "Middle", "Ring", "Little", "Palm"];

/** Left before right, then thumb to little finger, palm last. */
function partOrder(a: string, b: string): number {
  const rank = (part: string) =>
    (part.startsWith("left") ? 0 : 10) +
    PART_ORDER.indexOf(part.replace(/^(left|right)/, ""));
  return rank(a) - rank(b);
}

/**
 * Contacts on one Avatar, on raw (skinned) bones so the solver is verified
 * independently of it. Each contact point is the bone's `point` (and the
 * target's `targetPoint`) carried by the bone's rest-aligned frame; the
 * offset is scaled by the Avatar's `contactScale`.
 *
 * - Every contact: FAIL beyond its tolerance (solved: at most
 *   `solvedContactTolerance`, "unreachable on this Avatar").
 * - Solved contacts: WARN when the authored arm's point is far from the
 *   target at full weight (`reachCorrection`).
 * - `facing`: WARN when the palm turns away from the target.
 */
function checkContacts(
  avatar: string,
  times: readonly number[],
  frames: readonly Frame[],
  unsolvedFrames: readonly Frame[],
  body: AvatarBody,
  contacts: readonly CheckedContact[],
): MotionCheckFinding[] {
  const findings: MotionCheckFinding[] = [];
  const scale = body.contactScale;
  for (const contact of contacts) {
    const subject = `${contact.bone}→${contact.target}`;
    const bone = contact.bone as VRMHumanBoneName;
    const target = contact.target as VRMHumanBoneName;
    const finding = (
      severity: "fail" | "warn",
      time: number,
      value: number,
      limit: number,
      unit: string,
      detail: string,
      actualOffset?: [number, number, number],
    ): MotionCheckFinding => ({
      ...(actualOffset ? { actualOffset } : {}),
      category: "contact",
      severity,
      avatar,
      subject,
      from: time,
      to: time,
      value,
      limit,
      unit,
      detail,
    });
    try {
      body.skeleton.pointOffset(bone, contact.point);
      body.skeleton.pointOffset(target, contact.targetPoint);
    } catch (error) {
      findings.push(
        finding("fail", contact.from, 0, 0, "", (error as Error).message),
      );
      continue;
    }
    const tolerance = contact.solved
      ? Math.min(
          contact.tolerance ?? T.contactTolerance,
          T.solvedContactTolerance,
        )
      : (contact.tolerance ?? T.contactTolerance);
    /** The contact's point, its target point and the offset target on a frame. */
    const measure = (frame: Frame) => {
      const from = body.point(frame, bone, contact.point);
      const base = body.point(frame, target, contact.targetPoint);
      if (!from || !base) return null;
      const delta = body.delta(frame, target);
      const to = new Vector3(...(contact.offset ?? [0, 0, 0]))
        .multiplyScalar(scale)
        .applyQuaternion(delta)
        .add(base);
      const actual = from
        .clone()
        .sub(base)
        .applyQuaternion(delta.clone().invert())
        .divideScalar(scale)
        .toArray()
        .map((n) => round(n, 3)) as [number, number, number];
      return { distance: from.distanceTo(to), actual };
    };
    times.forEach((time, index) => {
      if (time < contact.from - 1e-6 || time > contact.to + 1e-6) return;
      const reached = measure(frames[index]);
      if (!reached) {
        findings.push(
          finding("fail", time, 0, 0, "", "the Avatar lacks a contact bone"),
        );
        return;
      }
      if (reached.distance > tolerance)
        findings.push(
          finding(
            "fail",
            time,
            round(reached.distance, 3),
            tolerance,
            "m",
            contact.solved
              ? "solved contact is not reached: unreachable on this Avatar"
              : "declared contact is not reached",
            reached.actual,
          ),
        );
      if (contact.solved) {
        const authored = measure(unsolvedFrames[index]);
        const limit = T.reachCorrection * scale;
        if (authored && authored.distance > limit)
          findings.push(
            finding(
              "warn",
              time,
              round(authored.distance, 3),
              round(limit, 3),
              "m",
              "the authored arm is far from this solved contact (the solver does the reaching); bring the authored hand nearer the target",
              authored.actual,
            ),
          );
      }
      if (contact.facing) {
        const angle = palmFacingAngle(body, frames[index], contact);
        if (angle !== null && angle > T.facingDegrees)
          findings.push(
            finding(
              "warn",
              time,
              round(angle),
              T.facingDegrees,
              "°",
              "the palm does not face the target",
            ),
          );
      }
    });
  }
  return findings;
}

/**
 * Where each bone's segment ends, for aiming a palm at the nearest point of a
 * target bone: the next joint along the spine or limb (the first one the rig
 * has). Fingers end at their tip; hands and the head are aimed at their
 * middle instead.
 */
const SEGMENT_END: Readonly<Record<string, readonly string[]>> = {
  hips: ["spine"],
  spine: ["chest"],
  chest: ["upperChest", "neck"],
  upperChest: ["neck"],
  neck: ["head"],
  Shoulder: ["UpperArm"],
  UpperArm: ["LowerArm"],
  LowerArm: ["Hand"],
  UpperLeg: ["LowerLeg"],
  LowerLeg: ["Foot"],
  Foot: ["Toes"],
};

/**
 * Angle in degrees between the palm normal of the contact bone's hand and the
 * direction from the hand's centre to the target, or null when undefined.
 *
 * The palm normal is the hand's rest −Y (the canonical T-pose holds both palms
 * down) carried by its rest-aligned frame, so both sides share it. The aim is
 * the target body part, not the touch point (`offset` and `targetPoint` are
 * ignored): during a touch the touch point lies on the palm itself (or at the
 * fingertips, along the fingers), so the direction to it says nothing about
 * the palm. A hand target is aimed at its centre, a head target halfway from
 * the head joint to the eyes, and any other bone at the point of its segment
 * (from its joint to the next joint, or a finger's tip) nearest the hand's
 * centre, so a palm resting anywhere along a forearm or the spine aims
 * straight into it.
 */
function palmFacingAngle(
  body: AvatarBody,
  frame: Frame,
  contact: MotionCheckContact,
): number | null {
  const side = handSideOf(contact.bone);
  if (!side) return null;
  const hand: VRMHumanBoneName = `${side}Hand`;
  const centre = body.handCentre(frame, side);
  if (!centre || !frame.rotations.has(hand)) return null;
  const normal = new Vector3(0, -1, 0).applyQuaternion(body.delta(frame, hand));
  const aim = facingAim(
    body,
    frame,
    contact.target as VRMHumanBoneName,
    centre,
  );
  if (!aim) return null;
  const direction = aim.sub(centre);
  if (direction.lengthSq() < 1e-8) return null;
  return (normal.angleTo(direction) * 180) / Math.PI;
}

/** The point of `target` a palm at `from` should face (see `palmFacingAngle`). */
function facingAim(
  body: AvatarBody,
  frame: Frame,
  target: VRMHumanBoneName,
  from: Vector3,
): Vector3 | null {
  const targetSide = HAND_BONE.exec(target)?.[1] as Side | undefined;
  if (targetSide) return body.handCentre(frame, targetSide);
  const joint = frame.positions.get(target);
  if (!joint) return null;
  if (/^(head|leftEye|rightEye|jaw)$/.test(target)) {
    const head = frame.positions.get("head") ?? joint;
    const left = frame.positions.get("leftEye");
    const right = frame.positions.get("rightEye");
    return left && right
      ? head.clone().lerp(left.clone().add(right).multiplyScalar(0.5), 0.5)
      : head.clone();
  }
  const side = /^(left|right)/.exec(target)?.[1] ?? "";
  const end = FINGER_BONE.test(target)
    ? body.point(frame, target, "tip")
    : (SEGMENT_END[target.slice(side.length)] ?? [])
        .map((next) =>
          frame.positions.get(`${side}${next}` as VRMHumanBoneName),
        )
        .find(Boolean);
  if (!end) return joint.clone();
  const axis = end.clone().sub(joint);
  const along = clamp01(from.clone().sub(joint).dot(axis) / axis.lengthSq());
  return joint
    .clone()
    .addScaledVector(axis, Number.isFinite(along) ? along : 0);
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
        const now = frame.positions.get(bone);
        const then = rest.positions.get(bone);
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
 * `checkMotion` passes the authored (unsolved) arms, which solved contacts
 * change per Avatar by design.
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
      if (Math.abs(finding.value) > Math.abs(current.value)) {
        current.value = finding.value;
        if (finding.actualOffset) current.actualOffset = finding.actualOffset;
      }
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
    const where = finding.actualOffset
      ? `; the point is at offset [${finding.actualOffset.join(", ")}] m from the target`
      : "";
    return `${finding.severity.toUpperCase()} ${finding.category}${who} ${finding.subject} at ${when}: ${finding.detail} (${finding.value}${finding.unit}, limit ${finding.limit}${finding.unit}${where})`;
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
