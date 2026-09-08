import { describe, expect, it } from "vitest";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import {
  calculateManifestEffectiveDurationSec,
  evaluateManifestIdleEntries,
  getManifestAnimationInventory,
  getManifestGestureById,
  getManifestGestureEntries,
  normalizeManifestGestureId,
  resolveAnimationUrl,
  selectManifestIdleCandidateFromEntries,
  type ManifestAnimationEntry,
} from "@/lib/avatar/animationManifest";

function entry(
  overrides: Partial<ManifestAnimationEntry> = {},
): ManifestAnimationEntry {
  return {
    name: "Neutral Idle",
    file: "neutral/idle_neutral.vrma",
    type: "vrma",
    disabled: false,
    loop_type: "once",
    emotions: {},
    base_pose: "relaxedRest",
    animation_type: "idle",
    duration: 2,
    time_scale: 1,
    weight: 1,
    loop_count: 1,
    ...overrides,
  };
}

function emotionState(values: Partial<Record<string, number>> = {}) {
  const state = createEmptyEmotionStateMap();
  for (const [emotion, value] of Object.entries(values)) {
    if (emotion in state) {
      state[emotion as keyof typeof state] = value;
    }
  }
  return buildEmotionRuntimeState(state);
}

describe("animationManifest", () => {
  it("makes neutral idle entries eligible without active emotions", () => {
    const evaluation = evaluateManifestIdleEntries([entry()], emotionState());

    expect(evaluation.eligibleCount).toBe(1);
    expect(evaluation.eligibleCandidates[0]).toMatchObject({
      neutral: true,
      weight: 1,
      effectiveDurationSec: 2,
    });
  });

  it("uses the matching tracked emotion intensity weight", () => {
    const evaluation = evaluateManifestIdleEntries(
      [
        entry({
          name: "Joy Idle",
          file: "happy/idle_happy.vrma",
          emotions: {
            joy: { "1": 0.25, "2": 0.75, "3": 1 },
          },
        }),
      ],
      emotionState({ joy: 20 }),
    );

    expect(evaluation.eligibleCandidates[0]).toMatchObject({
      matchedEmotion: "joy",
      matchedLevel: 2,
      weight: 0.75,
    });
  });

  it("uses the strongest positive match when multiple emotions are active", () => {
    const evaluation = evaluateManifestIdleEntries(
      [
        entry({
          emotions: {
            joy: { "1": 0.4, "2": 0.4, "3": 0.4 },
            excitement: { "1": 0.2, "2": 0.9, "3": 0.9 },
          },
        }),
      ],
      emotionState({ joy: 20, excitement: 20 }),
    );

    expect(evaluation.eligibleCandidates[0]).toMatchObject({
      matchedEmotion: "excitement",
      matchedLevel: 2,
      weight: 0.9,
    });
  });

  it("excludes disabled, non-VRMA, zero-weight, and infinite idle entries", () => {
    const evaluation = evaluateManifestIdleEntries(
      [
        entry({ name: "Disabled", disabled: true }),
        entry({ name: "Pose Clip", type: "animaPoseClip" }),
        entry({ name: "Zero", weight: 0 }),
        entry({ name: "Infinite", loop_type: "repeat", loop_count: undefined }),
      ],
      emotionState(),
    );

    expect(evaluation.eligibleCount).toBe(0);
    expect(
      evaluation.candidates.map((candidate) => candidate.exclusionReason),
    ).toEqual([
      "disabled",
      "nonVrma",
      "nonPositiveWeight",
      "nonFiniteDuration",
    ]);
  });

  it("selects weighted candidates deterministically and avoids the previous file", () => {
    const first = entry({
      name: "First",
      file: "neutral/first.vrma",
      weight: 1,
    });
    const second = entry({
      name: "Second",
      file: "neutral/second.vrma",
      weight: 3,
    });

    const weighted = selectManifestIdleCandidateFromEntries({
      entries: [first, second],
      emotionalState: emotionState(),
      randomRoll: 0.6,
    });
    const avoided = selectManifestIdleCandidateFromEntries({
      entries: [first, second],
      emotionalState: emotionState(),
      randomRoll: 0,
      previousFile: "neutral/first.vrma",
    });

    expect(weighted.selected?.file).toBe("neutral/second.vrma");
    expect(avoided.selected?.file).toBe("neutral/second.vrma");
  });

  it("computes finite durations with runtime loop semantics", () => {
    expect(calculateManifestEffectiveDurationSec(2, 1, "once")).toBe(2);
    expect(calculateManifestEffectiveDurationSec(2, 0.5, "repeat", 3)).toBe(12);
    expect(calculateManifestEffectiveDurationSec(2, 1, "pingpong", 2)).toBe(4);
    expect(calculateManifestEffectiveDurationSec(2, 1, "repeat")).toBeNull();
    expect(calculateManifestEffectiveDurationSec(2, 1, "pingpong")).toBe(4);
  });

  it("indexes non-disabled manifest gestures by normalized id", () => {
    const gestures = getManifestGestureEntries();
    const wave = getManifestGestureById("neutral/gesture/wave.vrma");
    const legacyWave = getManifestGestureById("gesture_wave");
    const explain = getManifestGestureById("explain");
    const thumbsUp = getManifestGestureById("double-thumbs-up");
    const legacyThumbsUp = getManifestGestureById("double-thumbs-up-clip");

    expect(gestures.length).toBeGreaterThan(0);
    expect(wave).toMatchObject({
      id: "wave",
      type: "vrma",
      file: "wave.vrma",
    });
    expect(legacyWave?.id).toBe("wave");
    expect(explain).toMatchObject({
      id: "explain",
      type: "vrma",
      file: "explain.vrma",
    });
    expect(thumbsUp).toMatchObject({
      id: "double-thumbs-up",
      type: "animaPoseClip",
      file: "double-thumbs-up",
    });
    expect(legacyThumbsUp?.id).toBe("double-thumbs-up");
    expect(gestures.every((gesture) => gesture.entry.disabled !== true)).toBe(
      true,
    );
  });

  it("keeps manifest VRMA entries in the flat public animation directory", () => {
    const vrmaEntries = getManifestAnimationInventory().filter(
      (entry) => entry.type === "vrma",
    );

    expect(vrmaEntries.length).toBeGreaterThan(0);
    expect(vrmaEntries.every((entry) => !entry.file.includes("/"))).toBe(true);
    expect(vrmaEntries.every((entry) => entry.file.endsWith(".vrma"))).toBe(
      true,
    );
    expect(vrmaEntries.every((entry) => !entry.file.startsWith("gesture_"))).toBe(
      true,
    );
  });

  it("normalizes gesture ids like backend animation hints", () => {
    expect(
      normalizeManifestGestureId(
        "/vrm/animations/neutral/gesture/gesture_wave.vrma",
      ),
    ).toBe("wave");
    expect(normalizeManifestGestureId("gesture_explain")).toBe("explain");
    expect(normalizeManifestGestureId("explain")).toBe("explain");
    expect(normalizeManifestGestureId("double-thumbs-up-clip")).toBe(
      "double-thumbs-up",
    );
  });

  it("resolves public VRMA URLs to the flat animation directory", () => {
    expect(resolveAnimationUrl("explain.vrma")).toBe(
      "/vrm/animations/explain.vrma",
    );
    expect(resolveAnimationUrl("gesture_explain.vrma")).toBe(
      "/vrm/animations/explain.vrma",
    );
    expect(resolveAnimationUrl("neutral/gesture/gesture_wave.vrma")).toBe(
      "/vrm/animations/wave.vrma",
    );
  });
});
