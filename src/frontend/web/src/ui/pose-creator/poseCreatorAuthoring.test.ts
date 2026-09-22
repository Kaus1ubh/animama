import { describe, expect, it } from "vitest";

import { parseAnimaPose } from "@/lib/avatar";
import {
  bakePoseCreatorAnimaPose,
  createUniquePoseCreatorBranchName,
  createBoneDraft,
  buildPoseCreatorAnimaPose,
  hasPoseCreatorDraftContent,
} from "./poseCreatorAuthoring";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  type PoseCreatorBoneDrafts,
  type PoseCreatorExpressionDrafts,
} from "@/stores/pose-creator-store";
import { shouldShowPoseCreatorBoneGizmo } from "./poseCreatorBoneGizmoVisibility";

describe("Pose Creator pose reuse", () => {
  it("keeps the cheap toolbar availability check consistent with pose export", () => {
    const rotation = {
      baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
      rotationDegrees: { x: 0, y: 0, z: 0 },
    };
    const boneCases: PoseCreatorBoneDrafts[] = [
      {},
      { head: rotation },
      { missingBone: rotation },
    ];
    const expressionCases: PoseCreatorExpressionDrafts[] = [
      {},
      { happy: { baseValue: 0, value: 0 } },
    ];
    for (const parentPose of [
      "relaxedRest",
      POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
      null,
    ]) {
      for (const boneDrafts of boneCases) {
        for (const expressionDrafts of expressionCases) {
          expect(
            hasPoseCreatorDraftContent(
              boneDrafts,
              expressionDrafts,
              parentPose,
            ),
          ).toBe(
            buildPoseCreatorAnimaPose(boneDrafts, expressionDrafts, {
              parentPose,
            }) !== null,
          );
        }
      }
    }
  });

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
  it.each(["pose", "clip"] as const)(
    "hides the gizmo when helpers are disabled in %s mode",
    (authoringMode) => {
      expect(
        shouldShowPoseCreatorBoneGizmo({
          boneHelperNodesVisible: false,
          authoringMode,
          hasClipInlineEdit: true,
          clipPlaybackPlaying: false,
        }),
      ).toBe(false);
    },
  );

  it("shows throughout Pose authoring", () => {
    expect(
      shouldShowPoseCreatorBoneGizmo({
        boneHelperNodesVisible: true,
        authoringMode: "pose",
        hasClipInlineEdit: false,
        clipPlaybackPlaying: false,
      }),
    ).toBe(true);
  });

  it("shows only for paused Clip inline-pose editing", () => {
    expect(
      shouldShowPoseCreatorBoneGizmo({
        boneHelperNodesVisible: true,
        authoringMode: "clip",
        hasClipInlineEdit: true,
        clipPlaybackPlaying: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPoseCreatorBoneGizmo({
        boneHelperNodesVisible: true,
        authoringMode: "clip",
        hasClipInlineEdit: true,
        clipPlaybackPlaying: true,
      }),
    ).toBe(false);
    expect(
      shouldShowPoseCreatorBoneGizmo({
        boneHelperNodesVisible: true,
        authoringMode: "clip",
        hasClipInlineEdit: false,
        clipPlaybackPlaying: false,
      }),
    ).toBe(false);
  });
});
