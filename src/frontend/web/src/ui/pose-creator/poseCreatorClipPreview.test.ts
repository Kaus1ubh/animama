import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { applyPoseCreatorClipPreviewExpressions } from "./poseCreatorClipPreview";

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
