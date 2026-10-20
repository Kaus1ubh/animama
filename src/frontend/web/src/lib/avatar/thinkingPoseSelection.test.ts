import { describe, expect, it } from "vitest";

import {
  getThinkingPoseChance,
  selectThinkingPoseClip,
  selectThinkingPoseClipId,
  THINKING_POSE_CLIP_IDS,
} from "./thinkingPoseSelection";

describe("thinking pose selection", () => {
  it("raises the chance of any pose with the prompt's length", () => {
    expect(getThinkingPoseChance("short")).toBe(0);
    expect(getThinkingPoseChance("x".repeat(20))).toBe(0.2);
    expect(getThinkingPoseChance("x".repeat(40))).toBe(0.4);
    expect(getThinkingPoseChance("x".repeat(60))).toBe(0.6);
    expect(getThinkingPoseChance("x".repeat(90))).toBe(0.8);
  });

  it("splits the pose chance evenly across the three clips", () => {
    expect(THINKING_POSE_CLIP_IDS).toEqual([
      "thinking-head-scratch",
      "thinking-hand-on-chin-hold",
      "thinking-chin-rest",
    ]);
    expect(selectThinkingPoseClipId(0, 0.6)).toBe("thinking-head-scratch");
    expect(selectThinkingPoseClipId(0.25, 0.6)).toBe(
      "thinking-hand-on-chin-hold",
    );
    expect(selectThinkingPoseClipId(0.45, 0.6)).toBe("thinking-chin-rest");
    expect(selectThinkingPoseClipId(0.6, 0.6)).toBeNull();
  });

  it("selects the chin rest for a run and names the request after it", () => {
    expect(
      selectThinkingPoseClip({
        runId: "run-1",
        inputText: "x".repeat(90),
        random: () => 0.7,
        nowMs: 5,
      }),
    ).toEqual({
      requestId: "run-1:thinking-pose:thinking-chin-rest",
      runId: "run-1",
      clipId: "thinking-chin-rest",
      selectedAtMs: 5,
    });
  });
});
