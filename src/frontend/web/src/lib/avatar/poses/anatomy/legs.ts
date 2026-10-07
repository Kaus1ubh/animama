import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";

import { isVrm0 } from "../poseRetargeting";
import type { Side } from "./anatomy";

type LegRest = {
  /** Hip joint offset from the hips bone, rest-aligned. */
  hipOffset: Vector3;
  thigh: Vector3;
  shin: Vector3;
  /** Ankle position in model space at rest. */
  ankle: Vector3;
};

/**
 * Two-bone leg solver that keeps each ankle and foot orientation at rest while
 * the hips rotate or translate (weight shifts, crouches, leans).
 *
 * It works in the canonical basis on an Avatar's normalized rig, whose bones
 * have identity rest rotations and model-aligned offsets. A VRM 0 rig faces
 * the other way, so its offsets are turned into the canonical basis; the
 * resulting rotations are canonical and go through the usual VRM 0 conversion
 * at playback. Solving on each Avatar's own rig keeps its feet planted
 * despite different proportions.
 */
export class PlantedLegSolver {
  private readonly hipsRest: Vector3;
  private readonly legs: Record<Side, LegRest>;

  constructor(vrm: VRM) {
    const vrm0 = isVrm0(vrm);
    const offset = (bone: VRMHumanBoneName) => {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) throw new Error(`The Avatar has no ${bone} bone.`);
      const { x, y, z } = node.position;
      return vrm0 ? new Vector3(-x, y, -z) : new Vector3(x, y, z);
    };
    this.hipsRest = offset("hips");
    const leg = (side: Side): LegRest => {
      const hipOffset = offset(`${side}UpperLeg`);
      const thigh = offset(`${side}LowerLeg`);
      const shin = offset(`${side}Foot`);
      return {
        hipOffset,
        thigh,
        shin,
        ankle: this.hipsRest.clone().add(hipOffset).add(thigh).add(shin),
      };
    };
    this.legs = { left: leg("left"), right: leg("right") };
  }

  /**
   * Local rotations for both legs, given the hips' rotation and its
   * translation from rest (both canonical).
   */
  solve(
    hipsRotation: Quaternion,
    hipsOffset: Vector3,
  ): Record<VRMHumanBoneName, Quaternion> {
    const result = {} as Record<VRMHumanBoneName, Quaternion>;
    const hipsPosition = this.hipsRest.clone().add(hipsOffset);
    const hipsInverse = hipsRotation.clone().invert();
    // Knees bend toward the pelvis's forward direction.
    const pole = new Vector3(0, 0, 1).applyQuaternion(hipsRotation);
    for (const side of ["left", "right"] as const) {
      const leg = this.legs[side];
      const hip = leg.hipOffset
        .clone()
        .applyQuaternion(hipsRotation)
        .add(hipsPosition);
      const thighLength = leg.thigh.length();
      const shinLength = leg.shin.length();
      const toAnkle = leg.ankle.clone().sub(hip);
      const reach = Math.min(
        Math.max(toAnkle.length(), Math.abs(thighLength - shinLength) + 1e-4),
        (thighLength + shinLength) * 0.9999,
      );
      const direction = toAnkle.normalize();
      const along =
        (thighLength * thighLength - shinLength * shinLength + reach * reach) /
        (2 * reach);
      const height = Math.sqrt(Math.max(thighLength ** 2 - along ** 2, 0));
      const bend = pole
        .clone()
        .sub(direction.clone().multiplyScalar(pole.dot(direction)));
      if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1);
      bend.normalize();
      const knee = hip
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(bend, height);
      const ankle = hip.clone().addScaledVector(direction, reach);

      // Swing the hips-carried thigh onto the knee; its twist follows the pelvis.
      const thighWorld = new Quaternion()
        .setFromUnitVectors(
          leg.thigh.clone().normalize().applyQuaternion(hipsRotation),
          knee.clone().sub(hip).normalize(),
        )
        .multiply(hipsRotation);
      const shinRest = leg.shin.clone().normalize().applyQuaternion(thighWorld);
      const shinWorld = new Quaternion()
        .setFromUnitVectors(shinRest, ankle.clone().sub(knee).normalize())
        .multiply(thighWorld);
      result[`${side}UpperLeg`] = hipsInverse.clone().multiply(thighWorld);
      result[`${side}LowerLeg`] = thighWorld
        .clone()
        .invert()
        .multiply(shinWorld);
      // Keep the foot level and facing its rest direction.
      result[`${side}Foot`] = shinWorld.clone().invert();
    }
    return result;
  }
}
