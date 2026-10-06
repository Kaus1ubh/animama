import type { VRM } from "@pixiv/three-vrm";
import { Quaternion } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import {
  handPresetQuaternion,
  resolveHandBones,
} from "../poses/anatomy/handPresets";
import {
  parseAnimaPoseClip,
  sampleAnimaPoseClip,
} from "../poses/animaPoseClip";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../poses/catalog";
import {
  angularDistanceDegrees,
  composeJointRotation,
  resolveJoint,
} from "../poses/anatomy/anatomy";
import { bakeMotion, createMotionEvaluator } from "./bake";
import {
  DEFAULT_GENERATED_MUTED_LAYERS,
  parseMotionDescription,
  type MotionDescription,
} from "./description";
import wave from "./examples/wave-hello.motion.json";
import { applyCanonicalPose, rawBoneWorldPosition } from "./kinematics";
import { loadTestAvatar } from "./testing/includedAvatars";

let reference: VRM;
let vrm0: VRM;

beforeAll(async () => {
  reference = await loadTestAvatar("AvatarSample_A_1_New");
  vrm0 = await loadTestAvatar("AvatarSample_Y_0");
});

const parse = (value: unknown): MotionDescription => {
  const result = parseMotionDescription(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.description;
};

const resolvePose = (id: string) =>
  id === RELAXED_REST_POSE_ID ? getResolvedAvatarPose(id) : null;

describe("bakeMotion", () => {
  it("produces a valid, deterministic Gesture sequence", () => {
    const description = parse(wave);
    const first = bakeMotion(description, reference);
    const second = bakeMotion(description, reference);
    expect(JSON.stringify(first.clip)).toBe(JSON.stringify(second.clip));
    const parsed = parseAnimaPoseClip(first.clip);
    expect(parsed.id).toBe("wave-hello");
    expect(parsed.name).toBe("Wave Hello");
    expect(parsed.basePose).toBe(RELAXED_REST_POSE_ID);
    expect(first.clip.mutedProceduralLayers).toEqual(
      DEFAULT_GENERATED_MUTED_LAYERS,
    );
    expect(first.report.keyframes).toBeGreaterThanOrEqual(79);
  });

  it("plays back the described curves on both Avatars", () => {
    const description = parse(wave);
    const { clip, report } = bakeMotion(description, reference);
    expect(report.withinTolerance).toBe(true);
    const parsed = parseAnimaPoseClip(clip);
    const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid!;
    const evaluator = createMotionEvaluator(description, base, reference);
    for (let time = 0.013; time < description.duration; time += 0.0517) {
      const played = sampleAnimaPoseClip(parsed, time, resolvePose).sample;
      const exact = evaluator.humanoid(time);
      for (const [bone, transform] of exact) {
        const actual = new Quaternion(...played.humanoid![bone]!.rotation!);
        expect(
          angularDistanceDegrees(
            actual,
            new Quaternion(...transform.rotation!),
          ),
          `${bone} at ${time}`,
        ).toBeLessThan(1.05);
      }
      expect(played.expressions!.happy).toBeCloseTo(
        evaluator.expressions(time).happy,
        2,
      );
      // Rendered positions agree on each Avatar too.
      for (const vrm of [reference, vrm0]) {
        const exactPose = { ...base, ...Object.fromEntries(exact) };
        applyCanonicalPose(vrm, exactPose);
        const expected = rawBoneWorldPosition(vrm, "rightMiddleDistal")!;
        applyCanonicalPose(vrm, played.humanoid!);
        expect(
          rawBoneWorldPosition(vrm, "rightMiddleDistal")!.distanceTo(expected),
        ).toBeLessThan(0.012);
      }
    }
  });

  it("densifies fast motion to the tolerance and bakes steps exactly", () => {
    const { clip, report } = bakeMotion(
      parse({
        schema: "animamaMotion/1",
        name: "Snap",
        kind: "oneShot",
        duration: 1,
        sampleRate: 10,
        joints: {
          rightLowerArm: {
            flexion: [
              { t: 0, v: 0 },
              { t: 0.2, v: 120 },
              { t: 0.4, v: 0 },
            ],
          },
          head: {
            rotation: [
              { t: 0, v: 0, interp: "step" },
              { t: 0.55, v: 20 },
            ],
          },
        },
      }),
      reference,
    );
    expect(report.withinTolerance).toBe(true);
    const head = (time: number) =>
      sampleAnimaPoseClip(clip, time, resolvePose).sample.humanoid!.head!
        .rotation!;
    expect(
      angularDistanceDegrees(new Quaternion(...head(0.548)), new Quaternion()),
    ).toBeLessThan(0.1);
    expect(
      angularDistanceDegrees(
        new Quaternion(...head(0.551)),
        new Quaternion(...head(0.6)),
      ),
    ).toBeLessThan(0.1);
  });

  it("loops hand shapes across the seam", () => {
    const { clip } = bakeMotion(
      parse({
        schema: "animamaMotion/1",
        name: "Grip Loop",
        kind: "loop",
        duration: 2,
        hands: {
          right: [
            { t: 0.2, preset: "fist" },
            { t: 1.2, preset: "open-spread" },
          ],
        },
      }),
      reference,
    );
    const finger = (index: number) => {
      const pose = clip.poses[clip.poseKeyframes.at(index)!.pose];
      return new Quaternion(
        ...("humanoid" in pose
          ? pose.humanoid!.rightIndexProximal!.rotation!
          : [0, 0, 0, 1]),
      );
    };
    expect(angularDistanceDegrees(finger(0), finger(-1))).toBeLessThan(1e-3);
  });

  it("lets keyed finger joints override a hand shape", () => {
    const { clip } = bakeMotion(
      parse({
        schema: "animamaMotion/1",
        name: "Point Curl",
        kind: "oneShot",
        duration: 1,
        hands: { right: [{ t: 0, preset: "point" }] },
        joints: { rightIndexDistal: { curl: [{ t: 0, v: 30 }] } },
      }),
      reference,
    );
    const pose = clip.poses[clip.poseKeyframes[0].pose];
    const rotation =
      "humanoid" in pose ? pose.humanoid!.rightIndexDistal!.rotation! : null;
    expect(
      angularDistanceDegrees(
        new Quaternion(...rotation!),
        composeJointRotation(resolveJoint("rightIndexDistal")!, { curl: 30 }),
      ),
    ).toBeLessThan(1e-3);
  });

  it("writes the creator's Hands presets on the reference Avatar", () => {
    const { clip } = bakeMotion(parse(wave), reference);
    const at =
      clip.poses[clip.poseKeyframes.find((k) => k.time === 0.45)!.pose];
    applyCanonicalPose(
      reference,
      getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid!,
    );
    const { available } = resolveHandBones({ vrm: reference }, "right");
    const middle = available.find(
      (bone) => bone.boneName === "rightMiddleDistal",
    )!;
    const expected = handPresetQuaternion(middle, "open-together", {
      vrm: reference,
    });
    const actual = new Quaternion(
      ...("humanoid" in at
        ? at.humanoid!.rightMiddleDistal!.rotation!
        : [0, 0, 0, 1]),
    );
    expect(angularDistanceDegrees(actual, expected)).toBeLessThan(0.01);
    expect(
      "humanoid" in at && at.humanoid!.rightThumbMetacarpal,
    ).toBeUndefined();
  });

  it("keeps feet planted while the hips shift and turn", () => {
    const description = parse({
      schema: "animamaMotion/1",
      name: "Weight Shift",
      kind: "oneShot",
      duration: 1,
      joints: {
        hips: {
          rotation: [
            { t: 0, v: 0 },
            { t: 1, v: 12 },
          ],
          lateralFlexion: [
            { t: 0, v: 0 },
            { t: 1, v: 5 },
          ],
        },
      },
      hipsPosition: {
        x: [
          { t: 0, v: 0 },
          { t: 1, v: 0.04 },
        ],
        y: [
          { t: 0, v: 0 },
          { t: 1, v: -0.03 },
        ],
      },
    });
    const { clip } = bakeMotion(description, reference);
    for (const vrm of [reference, vrm0]) {
      applyCanonicalPose(
        vrm,
        getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid!,
      );
      const rest = rawBoneWorldPosition(vrm, "leftFoot")!;
      const sample = sampleAnimaPoseClip(clip, 1, resolvePose).sample;
      applyCanonicalPose(vrm, sample.humanoid!);
      const drift = rawBoneWorldPosition(vrm, "leftFoot")!.distanceTo(rest);
      // Exact on the reference; proportions leave a small drift elsewhere.
      expect(drift).toBeLessThan(vrm === reference ? 0.002 : 0.03);
    }
  });

  it("holds untracked joints at the base pose and resolves base keys", () => {
    const { clip } = bakeMotion(parse(wave), reference);
    const first = clip.poses[clip.poseKeyframes[0].pose];
    expect("humanoid" in first && first.humanoid!.leftUpperArm).toBeUndefined();
    const base =
      getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid!.rightUpperArm!
        .rotation!;
    const baked =
      "humanoid" in first ? first.humanoid!.rightUpperArm!.rotation! : null;
    expect(
      angularDistanceDegrees(
        new Quaternion(...base),
        new Quaternion(...baked!),
      ),
    ).toBeLessThan(0.01);
  });

  it("starts and ends a keyed thumb at its base rotation", () => {
    const { clip } = bakeMotion(
      parse({
        schema: "animamaMotion/1",
        name: "Thumb Flick",
        kind: "oneShot",
        duration: 1,
        joints: {
          rightThumbProximal: {
            curl: [
              { t: 0, v: "base" },
              { t: 0.5, v: 30 },
              { t: 1, v: "base" },
            ],
          },
        },
      }),
      reference,
    );
    const base =
      getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid!.rightThumbProximal!
        .rotation!;
    for (const index of [0, -1]) {
      const pose = clip.poses[clip.poseKeyframes.at(index)!.pose];
      const rotation =
        "humanoid" in pose
          ? pose.humanoid!.rightThumbProximal!.rotation!
          : null;
      expect(
        angularDistanceDegrees(
          new Quaternion(...rotation!),
          new Quaternion(...base),
        ),
      ).toBeLessThan(0.01);
    }
  });

  it("joins a loop seamlessly", () => {
    const { clip } = bakeMotion(
      parse({
        schema: "animamaMotion/1",
        name: "Sway Loop",
        kind: "loop",
        duration: 2,
        joints: {
          chest: {
            rotation: [
              { t: 0, v: -4 },
              { t: 1, v: 4 },
              { t: 2, v: -4 },
            ],
          },
        },
      }),
      reference,
    );
    const pose = (index: number) => {
      const p = clip.poses[clip.poseKeyframes.at(index)!.pose];
      return new Quaternion(
        ...("humanoid" in p ? p.humanoid!.chest!.rotation! : [0, 0, 0, 1]),
      );
    };
    expect(clip.loop).toBe(true);
    expect(angularDistanceDegrees(pose(0), pose(-1))).toBeLessThan(1e-3);
  });
});
