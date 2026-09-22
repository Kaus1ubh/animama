import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  applyPoseCreatorClipPreview,
  applyPoseCreatorClipPreviewExpressions,
} from "./poseCreatorClipPreview";

import {
  createDefaultPoseCreatorClipDraft,
  buildAnimaPoseClipFromPoseCreatorDraft,
} from "./poseCreatorClipAuthoring";

describe("Reaction preview posture", () => {
  it.each(["expressions", "events", "empty"] as const)(
    "keeps Relaxed Rest for %s without changing the Reaction payload",
    (content) => {
      const draft = createDefaultPoseCreatorClipDraft("");
      if (content === "expressions") {
        draft.poses = { smile: { expressions: { happy: 0.7 } } };
        draft.keyframes = [{ id: "smile", pose: "smile", time: 0 }];
      }
      if (content === "events")
        draft.events = [{ id: "sound", kind: "sfx", cueId: "bell", time: 0 }];
      const applyPose = vi.fn();
      const applyAnimaPose = vi.fn();
      const setExpression = vi.fn();
      const avatar = {
        vrm: { humanoid: { resetNormalizedPose: vi.fn() }, update: vi.fn() },
        forgetPose: vi.fn(),
        applyPose,
        applyAnimaPose,
        clearAllExpressionOverrides: vi.fn(),
        getAvailableExpressions: () => ["happy"],
        setExpression,
      } as unknown as Avatar;
      for (const time of [0, 0.5, 1, 0]) {
        draft.currentTimeSec = time;
        const before = structuredClone(draft);
        const beforePayload = buildAnimaPoseClipFromPoseCreatorDraft(draft);
        applyPoseCreatorClipPreview(
          avatar,
          draft,
          DEFAULT_POSE_CREATOR_BASE_POSE,
        );
        expect(applyPose).toHaveBeenLastCalledWith("relaxedRest");
        expect(draft).toEqual(before);
        expect(buildAnimaPoseClipFromPoseCreatorDraft(draft)).toEqual(
          beforePayload,
        );
        expect(beforePayload?.basePose).toBeUndefined();
      }
      for (const [sample] of applyAnimaPose.mock.calls)
        expect(Object.keys(sample.humanoid ?? {})).toHaveLength(0);
      if (content === "expressions")
        expect(setExpression).toHaveBeenLastCalledWith("happy", 0.7);
    },
  );
  it("preserves the explicit no-base Gesture T-pose", () => {
    const draft = createDefaultPoseCreatorClipDraft("");
    const resetNormalizedPose = vi.fn();
    const applyPose = vi.fn();
    const avatar = {
      vrm: { humanoid: { resetNormalizedPose }, update: vi.fn() },
      forgetPose: vi.fn(),
      applyPose,
      clearAllExpressionOverrides: vi.fn(),
    } as unknown as Avatar;
    applyPoseCreatorClipPreview(avatar, draft);
    expect(resetNormalizedPose).toHaveBeenCalledOnce();
    expect(applyPose).not.toHaveBeenCalled();
    expect(draft.basePose).toBe("");
  });
});

describe("applyPoseCreatorClipPreviewExpressions", () => {
  it("pins the complete sampled facial state through Avatar overrides", () => {
    const clearAllExpressionOverrides = vi.fn();
    const setExpression = vi.fn();
    const avatar = {
      clearAllExpressionOverrides,
      getAvailableExpressions: () => ["happy", "sad", "surprised"],
      setExpression,
    } as unknown as Avatar;

    applyPoseCreatorClipPreviewExpressions(avatar, {
      happy: 0.25,
      surprised: 0.8,
    });

    expect(clearAllExpressionOverrides).toHaveBeenCalledOnce();
    expect(setExpression.mock.calls).toEqual([
      ["happy", 0.25],
      ["surprised", 0.8],
    ]);
  });
});

describe("blank timeline preview", () => {
  it("replaces any prior humanoid and expression state with its base pose", () => {
    usePoseCreatorStore.getState().resetWorkspace();
    const resetNormalizedPose = vi.fn();
    const applyPose = vi.fn();
    const clearAllExpressionOverrides = vi.fn();
    const avatar = {
      vrm: { humanoid: { resetNormalizedPose }, update: vi.fn() },
      forgetPose: vi.fn(),
      applyPose,
      clearAllExpressionOverrides,
    } as unknown as Avatar;

    applyPoseCreatorClipPreview(
      avatar,
      usePoseCreatorStore.getState().clipDraft,
    );

    expect(resetNormalizedPose).toHaveBeenCalledOnce();
    expect(applyPose).toHaveBeenCalledWith("relaxedRest");
    expect(clearAllExpressionOverrides).toHaveBeenCalledOnce();
  });
});
