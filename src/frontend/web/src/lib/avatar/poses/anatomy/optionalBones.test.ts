import { readFileSync } from "node:fs";
import {
  VRMHumanBoneList,
  VRMRequiredHumanBoneName,
  type VRMHumanBoneName,
  type VRMPose,
} from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  includedGestureClipPath,
  includedGestureClipSlugs,
} from "../../motion-authoring/testing/includedClipSamples";
import { parseAnimaPoseClip } from "../animaPoseClip";
import { prepareAnimaPoseClipV2 } from "../animaPoseClip/prepareV2";
import { getResolvedAvatarPose } from "../catalog";
import { angularDistanceDegrees } from "./anatomy";
import {
  CONTENT_OPTIONAL_BONES,
  foldMissingTorsoRotations,
  missingOptionalBones,
  standInBone,
  torsoFoldsFor,
} from "./optionalBones";

/** A rig with every humanoid bone except `missing`. */
const rigWithout =
  (...missing: VRMHumanBoneName[]) =>
  (bone: VRMHumanBoneName) =>
    !missing.includes(bone);

/** A rotation about the x or z axis, as a pose tuple. */
const quaternion = (axis: "x" | "z", degrees: number) =>
  new Quaternion()
    .setFromAxisAngle(
      axis === "x" ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1),
      MathUtils.degToRad(degrees),
    )
    .toArray() as [number, number, number, number];

describe("standInBone", () => {
  it("keeps a bone the rig has", () => {
    expect(standInBone("upperChest", rigWithout())).toBe("upperChest");
  });

  it("uses the chest for a missing upper chest, and the spine below that", () => {
    expect(standInBone("upperChest", rigWithout("upperChest"))).toBe("chest");
    expect(standInBone("upperChest", rigWithout("upperChest", "chest"))).toBe(
      "spine",
    );
    expect(standInBone("chest", rigWithout("chest"))).toBe("spine");
  });

  it("uses the nearest segment of the same finger toward the hand", () => {
    expect(
      standInBone("rightIndexDistal", rigWithout("rightIndexDistal")),
    ).toBe("rightIndexIntermediate");
    expect(
      standInBone(
        "leftMiddleDistal",
        rigWithout("leftMiddleDistal", "leftMiddleIntermediate"),
      ),
    ).toBe("leftMiddleProximal");
    expect(
      standInBone(
        "leftThumbDistal",
        rigWithout("leftThumbDistal", "leftThumbProximal"),
      ),
    ).toBe("leftThumbMetacarpal");
  });

  it("finds nothing for a finger without segments, or a neck, shoulder or eye", () => {
    expect(
      standInBone(
        "rightMiddleDistal",
        rigWithout(
          "rightMiddleDistal",
          "rightMiddleIntermediate",
          "rightMiddleProximal",
        ),
      ),
    ).toBeNull();
    for (const bone of ["neck", "leftShoulder", "rightEye"] as const)
      expect(standInBone(bone, rigWithout(bone))).toBeNull();
  });
});

describe("missingOptionalBones", () => {
  it("is empty for a complete rig", () => {
    expect(missingOptionalBones(rigWithout())).toEqual([]);
  });

  it("lists what a rig lacks with the stand-in and what it covers", () => {
    expect(
      missingOptionalBones(
        rigWithout("upperChest", "leftIndexDistal", "leftEye", "jaw"),
      ),
    ).toEqual([
      { bone: "upperChest", standIn: "chest", covers: "motion_and_contacts" },
      { bone: "leftEye", standIn: null, covers: "nothing" },
      {
        bone: "leftIndexDistal",
        standIn: "leftIndexIntermediate",
        covers: "contacts",
      },
    ]);
  });

  it("covers every optional bone Included Gestures and their poses turn or touch", () => {
    const required = new Set<string>(Object.values(VRMRequiredHumanBoneName));
    const used = new Set<string>();
    for (const slug of includedGestureClipSlugs()) {
      const clip = parseAnimaPoseClip(
        JSON.parse(readFileSync(includedGestureClipPath(slug), "utf8")),
      );
      const prepared = prepareAnimaPoseClipV2(clip, {
        resolvePose: (id) => getResolvedAvatarPose(id),
      });
      // Poses store every bone; a bone only counts once something turns it.
      for (const share of [0, 0.25, 0.5, 0.75, 1])
        for (const [bone, transform] of Object.entries(
          prepared.sample(share * clip.duration).humanoid ?? {},
        ))
          if (
            transform?.rotation &&
            angularDistanceDegrees(
              new Quaternion(...transform.rotation),
              new Quaternion(),
            ) > 0.01
          )
            used.add(bone);
      for (const contact of clip.contacts ?? [])
        used.add(contact.bone).add(contact.target);
    }
    const optional = [...used].filter((bone) => !required.has(bone));
    expect(optional.length).toBeGreaterThan(0);
    expect(
      optional.filter(
        (bone) => !CONTENT_OPTIONAL_BONES.includes(bone as VRMHumanBoneName),
      ),
    ).toEqual([]);
    // Every listed bone is a VRM humanoid bone.
    for (const bone of CONTENT_OPTIONAL_BONES)
      expect(VRMHumanBoneList).toContain(bone);
  });
});

describe("foldMissingTorsoRotations", () => {
  it("leaves the pose alone on a complete rig", () => {
    const pose: VRMPose = { upperChest: { rotation: quaternion("x", 10) } };
    expect(foldMissingTorsoRotations(pose, torsoFoldsFor(rigWithout()))).toBe(
      pose,
    );
  });

  it("folds a missing upper chest's rotation into the chest", () => {
    const pose: VRMPose = {
      chest: { rotation: quaternion("x", 10) },
      upperChest: { rotation: quaternion("z", 6) },
      neck: { rotation: quaternion("x", 4) },
    };
    const folded = foldMissingTorsoRotations(
      pose,
      torsoFoldsFor(rigWithout("upperChest")),
    );
    expect(folded.upperChest).toBeUndefined();
    const expected = new Quaternion(...pose.chest!.rotation!).multiply(
      new Quaternion(...pose.upperChest!.rotation!),
    );
    expect(
      angularDistanceDegrees(
        new Quaternion(...folded.chest!.rotation!),
        expected,
      ),
    ).toBeLessThan(1e-6);
    expect(folded.neck).toEqual(pose.neck);
    // The input is not mutated.
    expect(pose.upperChest).toBeDefined();
  });

  it("folds both torso bones into the spine, keeping their order", () => {
    const pose: VRMPose = {
      spine: { rotation: quaternion("x", 5) },
      chest: { rotation: quaternion("z", 8) },
      upperChest: { rotation: quaternion("x", 12) },
    };
    const folded = foldMissingTorsoRotations(
      pose,
      torsoFoldsFor(rigWithout("chest", "upperChest")),
    );
    expect(Object.keys(folded)).toEqual(["spine"]);
    const expected = new Quaternion(...pose.spine!.rotation!)
      .multiply(new Quaternion(...pose.chest!.rotation!))
      .multiply(new Quaternion(...pose.upperChest!.rotation!));
    expect(
      angularDistanceDegrees(
        new Quaternion(...folded.spine!.rotation!),
        expected,
      ),
    ).toBeLessThan(1e-6);
  });

  it("uses the missing bone's rotation when the stand-in has none", () => {
    const folded = foldMissingTorsoRotations(
      { upperChest: { rotation: quaternion("x", 10) } },
      torsoFoldsFor(rigWithout("upperChest")),
    );
    expect(Object.keys(folded)).toEqual(["chest"]);
    expect(
      angularDistanceDegrees(
        new Quaternion(...folded.chest!.rotation!),
        new Quaternion(...quaternion("x", 10)),
      ),
    ).toBeLessThan(1e-6);
  });
});
