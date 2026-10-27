import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VRMHumanoid, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { loadTestAvatarWithGltf } from "../../motion-authoring/testing/includedAvatars";
import { prepareLoadedVrm } from "../../prepareLoadedVrm";
import { CanonicalSkeleton, SkeletonPose } from "./arms";
import { handShapeRotations } from "./handPresets";
import { applyCanonicalPose } from "../../motion-authoring/kinematics";
import { AVATAR_POSE_CATALOG, RELAXED_REST_POSE_ID } from "../catalog";
import { HAND_REST_TOLERANCE, installHandRestNormalization } from "./handRest";

/**
 * VRoid's left hand in VRM 1.0 axes: each child's offset from its parent
 * (the hand's from the lower arm), as `handRest.ts` measures it on Annie.
 */
const VROID_LEFT: Record<string, { parent: string; offset: number[] }> = {
  leftHand: { parent: "leftLowerArm", offset: [0.2, 0, 0] },
  leftIndexProximal: { parent: "leftHand", offset: [0.09, 0.01, 0.025] },
  leftIndexIntermediate: {
    parent: "leftIndexProximal",
    offset: [0.03, 0, -0.0006],
  },
  leftIndexDistal: {
    parent: "leftIndexIntermediate",
    offset: [0.02, -0.0006, -0.0008],
  },
  leftMiddleProximal: { parent: "leftHand", offset: [0.09, 0.01, 0.003] },
  leftMiddleIntermediate: {
    parent: "leftMiddleProximal",
    offset: [0.035, 0, 0],
  },
  leftMiddleDistal: { parent: "leftMiddleIntermediate", offset: [0.024, 0, 0] },
  leftLittleProximal: { parent: "leftHand", offset: [0.08, 0.008, -0.03] },
  leftLittleIntermediate: {
    parent: "leftLittleProximal",
    offset: [0.022, 0, 0],
  },
  leftLittleDistal: { parent: "leftLittleIntermediate", offset: [0.016, 0, 0] },
  leftThumbMetacarpal: { parent: "leftHand", offset: [0.02, -0.01, 0.02] },
  leftThumbProximal: {
    parent: "leftThumbMetacarpal",
    offset: [0.757 * 0.03, -0.044 * 0.03, 0.652 * 0.03],
  },
  leftThumbDistal: {
    parent: "leftThumbProximal",
    offset: [0.785 * 0.025, -0.034 * 0.025, 0.618 * 0.025],
  },
};

/**
 * A minimal VRM 1.0 humanoid (hips to the left hand's digits) whose hand and
 * fingers rest turned by `rest` about the wrist, as a converted model's might.
 */
function rotatedHandRig(
  rest: THREE.Quaternion,
  unmapped: readonly string[] = [],
): VRM {
  const scene = new THREE.Group();
  const nodes: Record<string, THREE.Object3D> = {};
  const add = (name: string, parent: THREE.Object3D, offset: number[]) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.fromArray(offset);
    parent.add(node);
    nodes[name] = node;
  };
  add("hips", scene, [0, 1, 0]);
  add("leftUpperArm", nodes.hips!, [0.2, 0.4, 0]);
  add("leftLowerArm", nodes.leftUpperArm!, [0.25, 0, 0]);
  for (const [name, { parent, offset }] of Object.entries(VROID_LEFT)) {
    // The wrist turns everything below it; the hand's own offset stays.
    const turned =
      parent === "leftLowerArm"
        ? offset
        : new THREE.Vector3().fromArray(offset).applyQuaternion(rest).toArray();
    add(name, nodes[parent]!, turned);
  }
  scene.updateMatrixWorld(true);
  // An unmapped bone stays in the skeleton but is not a humanoid bone.
  const humanBones = Object.fromEntries(
    Object.entries(nodes)
      .filter(([name]) => !unmapped.includes(name))
      .map(([name, node]) => [name, { node }]),
  ) as unknown as ConstructorParameters<typeof VRMHumanoid>[0];
  const humanoid = new VRMHumanoid(humanBones);
  scene.add(humanoid.normalizedHumanBonesRoot);
  return { scene, humanoid, meta: { metaVersion: "1" } } as unknown as VRM;
}

const rawDirection = (vrm: VRM, from: string, to: string) => {
  vrm.scene.updateMatrixWorld(true);
  const position = (bone: string) =>
    vrm.humanoid
      .getRawBoneNode(bone as VRMHumanBoneName)!
      .getWorldPosition(new THREE.Vector3());
  return position(to).sub(position(from)).normalize();
};

/**
 * The largest distance between a hand or finger bone's normalized joint and
 * its drawn joint, after the rig's current pose is transferred.
 */
function jointGap(vrm: VRM): number {
  vrm.humanoid.update();
  vrm.scene.updateMatrixWorld(true);
  let gap = 0;
  for (const bone of Object.keys(VROID_LEFT)) {
    const normalized = vrm.humanoid.getNormalizedBoneNode(
      bone as VRMHumanBoneName,
    );
    const raw = vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName);
    if (!normalized || !raw) continue;
    gap = Math.max(
      gap,
      normalized
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(raw.getWorldPosition(new THREE.Vector3())),
    );
  }
  return gap;
}

/** Bent 30° down and rolled 20°: about the converted test Avatar's hand. */
const TILTED = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 0, 1), (-30 * Math.PI) / 180)
  .multiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      (20 * Math.PI) / 180,
    ),
  );

describe("hand rest normalization", () => {
  it("leaves VRoid-like hands, the Included Avatars among them, alone", async () => {
    expect(
      installHandRestNormalization(rotatedHandRig(new THREE.Quaternion())),
    ).toBeNull();
    for (const id of [
      "AvatarSample_A_1_New",
      "Andrew",
      "AvatarSample_Y_0",
    ] as const) {
      const { vrm } = await loadTestAvatarWithGltf(id);
      const update = vrm.humanoid.update;
      expect(prepareLoadedVrm(vrm, { vrmSha256: null }).handRest).toBeNull();
      expect(vrm.humanoid.update, `${id} keeps three-vrm's update`).toBe(
        update,
      );
    }
  });

  it("straightens a turned hand to VRoid's rest", () => {
    const vrm = rotatedHandRig(TILTED);
    const normalization = installHandRestNormalization(vrm)!;
    expect(normalization.maxDegrees).toBeGreaterThan(
      (HAND_REST_TOLERANCE * 180) / Math.PI,
    );
    expect(installHandRestNormalization(vrm), "once per model").toBe(
      normalization,
    );
    vrm.humanoid.update();
    const reference = rotatedHandRig(new THREE.Quaternion());
    reference.humanoid.update();
    for (const [from, to] of [
      ["leftHand", "leftMiddleProximal"],
      ["leftIndexProximal", "leftIndexIntermediate"],
      ["leftThumbProximal", "leftThumbDistal"],
    ]) {
      expect(
        rawDirection(vrm, from!, to!).angleTo(
          rawDirection(reference, from!, to!),
        ),
        `${from} rests as VRoid's`,
      ).toBeLessThan(0.02);
    }
  });

  it("bends fingers and thumbs in VRoid's planes", () => {
    const vrm = rotatedHandRig(TILTED);
    installHandRestNormalization(vrm);
    const reference = rotatedHandRig(new THREE.Quaternion());
    // A curl and a thumb raise, as hand shapes write them.
    const pose = {
      leftIndexProximal: { rotation: [0, 0, 0.5, 0.866] },
      leftIndexIntermediate: { rotation: [0, 0, 0.6, 0.8] },
      leftThumbProximal: { rotation: [0.3, 0.2, 0, 0.933] },
    } as const;
    for (const rig of [vrm, reference]) {
      rig.humanoid.setNormalizedPose(pose as never);
      rig.humanoid.update();
    }
    for (const [from, to] of [
      ["leftIndexIntermediate", "leftIndexDistal"],
      ["leftThumbProximal", "leftThumbDistal"],
    ]) {
      expect(
        rawDirection(vrm, from!, to!).angleTo(
          rawDirection(reference, from!, to!),
        ),
        `${from} bends as on VRoid`,
      ).toBeLessThan(0.02);
    }
    // The authored rotations stay as written.
    expect(
      vrm.humanoid
        .getNormalizedBoneNode("leftIndexProximal")!
        .quaternion.toArray()
        .map((v) => Number(v.toFixed(3))),
    ).toEqual([0, 0, 0.5, 0.866]);
  });

  it.each(["thumbs-up", "fist", "point"] as const)(
    "shapes a %s on the turned hand as on VRoid's",
    (preset) => {
      const vrm = rotatedHandRig(TILTED);
      installHandRestNormalization(vrm);
      const reference = rotatedHandRig(new THREE.Quaternion());
      for (const rig of [vrm, reference]) {
        const rotations = handShapeRotations(
          rig,
          "left",
          { preset },
          undefined,
        );
        rig.humanoid.setNormalizedPose(
          Object.fromEntries(
            [...rotations].map(([bone, rotation]) => [
              bone,
              { rotation: rotation.toArray() },
            ]),
          ) as never,
        );
        rig.humanoid.update();
      }
      for (const [from, to] of [
        ["leftThumbProximal", "leftThumbDistal"],
        ["leftIndexIntermediate", "leftIndexDistal"],
        ["leftLittleIntermediate", "leftLittleDistal"],
      ]) {
        expect(
          rawDirection(vrm, from!, to!).angleTo(
            rawDirection(reference, from!, to!),
          ),
          `${preset}: ${from}`,
        ).toBeLessThan(0.03);
      }
    },
  );

  it("bends the idle catalog pose's fingers as on VRoid's", () => {
    const vrm = rotatedHandRig(TILTED);
    installHandRestNormalization(vrm);
    const reference = rotatedHandRig(new THREE.Quaternion());
    const relaxedRest = AVATAR_POSE_CATALOG[RELAXED_REST_POSE_ID]!.humanoid!;
    for (const rig of [vrm, reference]) applyCanonicalPose(rig, relaxedRest);
    for (const [from, to] of [
      ["leftThumbProximal", "leftThumbDistal"],
      ["leftIndexIntermediate", "leftIndexDistal"],
      ["leftLittleIntermediate", "leftLittleDistal"],
    ]) {
      expect(
        rawDirection(vrm, from!, to!).angleTo(
          rawDirection(reference, from!, to!),
        ),
        `relaxedRest: ${from}`,
      ).toBeLessThan(0.03);
    }
    expect(jointGap(vrm)).toBeLessThan(1e-6);
  });

  it.each([
    ["an intermediate", ["leftIndexIntermediate"]],
    ["a metacarpal", ["leftThumbMetacarpal"]],
  ])(
    "keeps the drawn hand on the normalized one without %s bone",
    (_, unmapped) => {
      const vrm = rotatedHandRig(TILTED, unmapped);
      expect(installHandRestNormalization(vrm)).not.toBeNull();
      const reference = rotatedHandRig(new THREE.Quaternion(), unmapped);
      const pose = {
        leftIndexProximal: { rotation: [0, 0, 0.5, 0.866] },
        leftThumbProximal: { rotation: [0.3, 0.2, 0, 0.933] },
      } as const;
      for (const rig of [vrm, reference]) {
        rig.humanoid.setNormalizedPose(pose as never);
        rig.humanoid.update();
      }
      expect(jointGap(vrm)).toBeLessThan(1e-6);
      for (const [from, to] of [
        ["leftIndexProximal", "leftIndexDistal"],
        ["leftThumbProximal", "leftThumbDistal"],
      ]) {
        expect(
          rawDirection(vrm, from!, to!).angleTo(
            rawDirection(reference, from!, to!),
          ),
          `${unmapped[0]} missing: ${from}`,
        ).toBeLessThan(0.03);
      }
    },
  );

  it("gives readers of the normalized rig the hand as drawn", () => {
    const vrm = rotatedHandRig(TILTED);
    installHandRestNormalization(vrm);
    const pose = {
      leftIndexProximal: { rotation: [0, 0, 0.5, 0.866] },
      leftIndexIntermediate: { rotation: [0, 0, 0.6, 0.8] },
    } as const;
    vrm.humanoid.setNormalizedPose(pose as never);
    vrm.humanoid.update();
    vrm.scene.updateMatrixWorld(true);
    // The contact solver's fingertip lands where the drawn finger is.
    const skeleton = new CanonicalSkeleton(vrm);
    const evaluated = new SkeletonPose(skeleton).setPose(pose as never);
    const tip = evaluated.contactPoint(
      "leftIndexIntermediate",
      "tip",
      new THREE.Vector3(),
    )!;
    const drawn = vrm.humanoid
      .getRawBoneNode("leftIndexDistal")!
      .getWorldPosition(new THREE.Vector3());
    const hips = vrm.humanoid
      .getRawBoneNode("hips")!
      .getWorldPosition(new THREE.Vector3());
    expect(
      tip.distanceTo(drawn.sub(hips).add(skeleton.restPosition("hips")!)),
    ).toBeLessThan(1e-4);
    // A reset keeps the normalized hand's shape.
    vrm.humanoid.resetNormalizedPose();
    expect(
      vrm.humanoid
        .getNormalizedBoneNode("leftIndexIntermediate")!
        .position.clone()
        .normalize()
        .angleTo(new THREE.Vector3(1, 0, -0.02).normalize()),
    ).toBeLessThan(0.02);
  });

  it("is installed by the shared load step that animation:render uses", async () => {
    const vrm = rotatedHandRig(TILTED);
    expect(prepareLoadedVrm(vrm, { vrmSha256: null }).handRest).not.toBeNull();
    const render = await readFile(
      fileURLToPath(
        new URL(
          "../../../../../scripts/animation-render/render.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(render).toMatch(/prepareLoadedVrm\(vrm,/);
  });
});
