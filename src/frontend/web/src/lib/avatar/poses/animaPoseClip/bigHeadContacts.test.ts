import { readFileSync } from "node:fs";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Box3, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { measureAvatarProportions } from "../../avatarProportions";
import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "../../motion-authoring/kinematics";
import { loadHeadlessVrmWithGltf } from "../../motion-authoring/headlessVrm";
import { includedGestureClipPath } from "../../motion-authoring/testing/includedClipSamples";
import { wholeBodyVrmBytes } from "../../testing/wholeBodyVrm";
import { CanonicalSkeleton } from "../anatomy/arms";
import { getResolvedAvatarPose } from "../catalog";
import { parseAnimaPoseClip } from "./index";
import { prepareAnimaPoseClipV2 } from "./prepareV2";

/*
 * Hand-to-face contacts on a big-headed Avatar: the synthetic whole-body
 * Avatar with its head scaled twice about the head bone (about twice the
 * adult share of its height). The Included `kyaa-hands-on-cheeks` puts both
 * palms on the cheeks; offsets from the head follow the head's size, so the
 * palms land on the face instead of inside the head at the jaw.
 */

async function loadVrm(headScale: number): Promise<VRM> {
  const bytes = wholeBodyVrmBytes({ headScale });
  const { vrm } = await loadHeadlessVrmWithGltf(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return vrm;
}

/** A palm's world position in the pose last applied (canonical frames). */
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

describe("kyaa-hands-on-cheeks on a big-headed Avatar", () => {
  it("puts both palms on the face", async () => {
    const vrm = await loadVrm(2);
    const clip = parseAnimaPoseClip(
      JSON.parse(
        readFileSync(includedGestureClipPath("kyaa-hands-on-cheeks"), "utf8"),
      ),
    );
    const prepared = prepareAnimaPoseClipV2(clip, {
      vrm,
      resolvePose: (id) => getResolvedAvatarPose(id),
    });
    // Mid-squeal, when both contacts hold at full weight.
    applyCanonicalPose(vrm, prepared.sample(1.2).humanoid ?? {});
    vrm.scene.updateMatrixWorld(true);

    const head = vrm.humanoid.getNormalizedBoneNode("head")!;
    const box = new Box3()
      .copy(measureAvatarProportions(vrm).headBox!)
      .applyMatrix4(head.matrixWorld);
    // The face is the head box's front (+z); the fringe hangs 3 cm in front.
    const front = box.max.z;
    for (const side of ["left", "right"] as const) {
      const point = palm(vrm, side);
      // Against the face, not sunk into the head or stopped short of it.
      expect(point.z).toBeGreaterThan(front - 0.06);
      expect(point.z).toBeLessThan(front + 0.06);
      // Within the face's outline, on its own side.
      expect(point.y).toBeGreaterThan(box.min.y);
      expect(point.y).toBeLessThan(box.max.y);
      expect(Math.abs(point.x)).toBeLessThan(box.max.x);
      expect(Math.sign(point.x)).toBe(side === "left" ? 1 : -1);
    }
  });
});
