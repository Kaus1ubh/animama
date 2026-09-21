import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  applyPoseCreatorClipPreview,
  applyPoseCreatorClipPreviewExpressions,
} from "./poseCreatorClipPreview";

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
