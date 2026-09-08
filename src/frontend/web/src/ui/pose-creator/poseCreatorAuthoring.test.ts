import { describe, expect, it } from "vitest";

import { parseAnimaPose } from "@/lib/avatar";
import {
  bakePoseCreatorAnimaPose,
  createUniquePoseCreatorBranchName,
  createBoneDraft,
} from "./poseCreatorAuthoring";
import { shouldShowPoseCreatorBoneGizmo } from "./poseCreatorBoneGizmoVisibility";

describe("Pose Creator pose reuse", () => {
  it("bakes a saved parented pose into an independent snapshot", () => {
    const baked = bakePoseCreatorAnimaPose(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "wave-branch",
        name: "Wave branch",
        parent: { ref: "relaxedRest" },
        humanoid: {
          rightUpperArm: { rotation: [0, 0, 0.7071068, 0.7071068] },
        },
      }),
    );

    expect(baked.parent).toBeUndefined();
    const armRotation = baked.humanoid?.rightUpperArm?.rotation;
    expect(armRotation?.[0]).toBeCloseTo(0);
    expect(armRotation?.[1]).toBeCloseTo(0);
    expect(armRotation?.[2]).toBeCloseTo(0.7071068);
    expect(armRotation?.[3]).toBeCloseTo(0.7071068);
    expect(Object.keys(baked.humanoid ?? {}).length).toBeGreaterThan(1);
  });

  it("allocates numeric branch names from plain and numbered source names", () => {
    expect(createUniquePoseCreatorBranchName("surprised", [])).toBe(
      "surprised (1)",
    );
    expect(createUniquePoseCreatorBranchName("shocked (1)", [])).toBe(
      "shocked (2)",
    );
  });

  it("skips used branch names case-insensitively", () => {
    expect(
      createUniquePoseCreatorBranchName(" Shocked (1) ", [
        "shocked (2)",
        "SHOCKED (3) ",
        "shocked (5)",
      ]),
    ).toBe("Shocked (4)");
  });

  it("preserves the pre-drag base quaternion supplied by direct manipulation", () => {
    const draft = createBoneDraft(
      null,
      "rightUpperArm",
      { x: 25, y: -10, z: 5 },
      null,
      [0, 0, 0, 1],
    );

    expect(draft).toEqual({
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 25, y: -10, z: 5 },
    });
  });
});

describe("Pose Creator bone gizmo visibility", () => {
  it("shows throughout Pose authoring", () => {
    expect(
      shouldShowPoseCreatorBoneGizmo({
        authoringMode: "pose",
        hasClipInlineEdit: false,
        clipPlaybackPlaying: false,
      }),
    ).toBe(true);
  });

  it("shows only for paused Clip inline-pose editing", () => {
    expect(
      shouldShowPoseCreatorBoneGizmo({
        authoringMode: "clip",
        hasClipInlineEdit: true,
        clipPlaybackPlaying: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPoseCreatorBoneGizmo({
        authoringMode: "clip",
        hasClipInlineEdit: true,
        clipPlaybackPlaying: true,
      }),
    ).toBe(false);
    expect(
      shouldShowPoseCreatorBoneGizmo({
        authoringMode: "clip",
        hasClipInlineEdit: false,
        clipPlaybackPlaying: false,
      }),
    ).toBe(false);
  });
});
