import { readFileSync } from "node:fs";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
  type TestAvatarId,
} from "../../motion-authoring/testing/includedAvatars";
import { includedGestureClipPath } from "../../motion-authoring/testing/includedClipSamples";
import {
  DISTAL_FINGER_BONES,
  loadTestAvatarWithout,
} from "../../testing/withoutHumanBones";
import { angularDistanceDegrees } from "../anatomy/anatomy";
import {
  CanonicalSkeleton,
  SkeletonPose,
  avatarScale,
  contactTargetPosition,
} from "../anatomy/arms";
import { getResolvedAvatarPose } from "../catalog";
import { parseAnimaPoseClip } from "./index";
import { prepareAnimaPoseClipV2 } from "./prepareV2";

/*
 * Contacts and torso motion on rigs without optional bones: an Included
 * Avatar (or the VRM 0 fixture) whose humanoid leaves out the upper chest or
 * the distal finger segments, as many VRChat conversions and low-poly
 * Avatars are rigged. The nodes stay, so the mesh is the same.
 */

const gesture = (slug: string) =>
  parseAnimaPoseClip(
    JSON.parse(readFileSync(includedGestureClipPath(slug), "utf8")),
  );

const prepare = (slug: string, vrm: VRM, solveContacts = true) =>
  prepareAnimaPoseClipV2(gesture(slug), {
    vrm,
    resolvePose: (id) => getResolvedAvatarPose(id),
    solveContacts,
  });

/** A hand's palm point in the pose last applied (canonical frames). */
function palm(vrm: VRM, side: "left" | "right"): Vector3 {
  const bone = `${side}Hand` as VRMHumanBoneName;
  const skeleton = new CanonicalSkeleton(vrm);
  const worldRotation = () =>
    vrm.humanoid.getRawBoneNode(bone)!.getWorldQuaternion(new Quaternion());
  const pose = vrm.humanoid.getNormalizedPose();
  applyCanonicalPose(vrm, {});
  const rest = worldRotation().invert();
  applyCanonicalPose(vrm, pose);
  return skeleton
    .pointOffset(bone, "palm")!
    .clone()
    .applyQuaternion(worldRotation().multiply(rest))
    .add(rawBoneWorldPosition(vrm, bone)!);
}

/** The right palm in `single-hand-on-heart` mid-hold, on `vrm`. */
function heartPalm(vrm: VRM): Vector3 {
  applyCanonicalPose(
    vrm,
    prepare("single-hand-on-heart", vrm).sample(1.5).humanoid ?? {},
  );
  return palm(vrm, "right");
}

describe("contacts on a rig without an upper chest", () => {
  it.each(["Andrew", VRM0_FIXTURE_ID] as TestAvatarId[])(
    "keeps the hand on the heart on %s",
    async (id) => {
      const complete = heartPalm(await loadTestAvatar(id));
      const rig = await loadTestAvatarWithout(id, ["upperChest"]);
      expect(rig.humanoid.getNormalizedBoneNode("upperChest")).toBeNull();
      // The contact lands at an estimate of the upper chest on the chest,
      // within a couple of centimetres of the complete rig's.
      expect(heartPalm(rig).distanceTo(complete)).toBeLessThan(0.02);
    },
  );

  it("keeps the hand on the heart on a rig without a chest either", async () => {
    const complete = heartPalm(await loadTestAvatar("Andrew"));
    const rig = await loadTestAvatarWithout("Andrew", ["chest", "upperChest"]);
    expect(heartPalm(rig).distanceTo(complete)).toBeLessThan(0.02);
  });

  it("keeps the hand on the heart when the only chest sits at upper-chest height", async () => {
    const complete = heartPalm(await loadTestAvatar("Andrew"));
    // The chest bone is mapped to the upper chest's node.
    const rig = await loadTestAvatarWithout("Andrew", ["upperChest"], {
      chest: "upperChest",
    });
    expect(heartPalm(rig).distanceTo(complete)).toBeLessThan(0.02);
  });

  it("folds the upper chest's bend into the chest", async () => {
    const complete = prepare(
      "single-hand-on-heart",
      await loadTestAvatar("Andrew"),
      false,
    ).sample(1.5).humanoid!;
    const sample = prepare(
      "single-hand-on-heart",
      await loadTestAvatarWithout("Andrew", ["upperChest"]),
      false,
    ).sample(1.5).humanoid!;
    expect(sample.upperChest).toBeUndefined();
    const expected = new Quaternion(...complete.chest!.rotation!).multiply(
      new Quaternion(...complete.upperChest!.rotation!),
    );
    expect(
      angularDistanceDegrees(
        new Quaternion(...sample.chest!.rotation!),
        expected,
      ),
    ).toBeLessThan(1e-4);
    // The bend is a real one, not an identity fold.
    expect(
      angularDistanceDegrees(
        new Quaternion(...complete.upperChest!.rotation!),
        new Quaternion(),
      ),
    ).toBeGreaterThan(1);
  });
});

describe("contacts on a rig without distal finger bones", () => {
  /**
   * In `who-me` mid-point, the distance from the right index finger's
   * contact point (its tip, on the segment that stands in for the distal) to
   * the upper chest target, in canonical space.
   */
  async function whoMeGap(bones: readonly VRMHumanBoneName[]) {
    const vrm = await loadTestAvatarWithout("Andrew", bones);
    const clip = gesture("who-me");
    const contact = clip.contacts!.find(
      (entry) => entry.bone === "rightIndexDistal" && entry.solve,
    )!;
    const skeleton = new CanonicalSkeleton(vrm);
    const pose = new SkeletonPose(skeleton).setPose(
      prepare("who-me", vrm).sample(1.0).humanoid ?? {},
    );
    const finger = skeleton.has("rightIndexDistal")
      ? "rightIndexDistal"
      : "rightIndexIntermediate";
    const tip = pose.contactPoint(finger, "tip", new Vector3())!;
    const target = contactTargetPosition(
      pose,
      { target: "upperChest", offset: contact.offset },
      avatarScale(skeleton),
      new Vector3(),
    );
    return { tip, target, finger };
  }

  it("puts the intermediate segment's tip on the target", async () => {
    const { tip, target, finger } = await whoMeGap(DISTAL_FINGER_BONES);
    expect(finger).toBe("rightIndexIntermediate");
    expect(target).not.toBeNull();
    expect(tip.distanceTo(target!)).toBeLessThan(0.005);
  });

  it("lands near the complete rig's target without an upper chest too", async () => {
    const complete = await whoMeGap([]);
    const { tip } = await whoMeGap([...DISTAL_FINGER_BONES, "upperChest"]);
    expect(tip.distanceTo(complete.target!)).toBeLessThan(0.02);
  });
});
