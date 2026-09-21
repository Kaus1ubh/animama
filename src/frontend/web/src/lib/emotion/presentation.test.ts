import { describe, expect, it } from "vitest";
import { EMOTION_GROUPS, TRACKED_EMOTIONS } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  EMOTION_PALETTE,
  FEELING_LABELS,
  formatEmotionAverage,
} from "./presentation";

describe("emotion presentation", () => {
  it("covers every group, tracked feeling and neutral", () => {
    expect(Object.keys(EMOTION_PALETTE)).toHaveLength(9);
    for (const group of [...EMOTION_GROUPS, "neutral" as const])
      expect(EMOTION_PALETTE[group]).toBeTruthy();
    expect(Object.keys(FEELING_LABELS)).toHaveLength(24);
    for (const emotion of TRACKED_EMOTIONS) {
      expect(FEELING_LABELS[emotion].label).toMatch(/^Feeling /);
      expect(FEELING_LABELS[emotion].emoji).toBeTruthy();
    }
  });
  it.each(TRACKED_EMOTIONS)(
    "resolves an active %s to its mapped feeling",
    (emotion) => {
      expect(buildEmotionPresentation({ [emotion]: 12 }).feeling).toEqual(
        FEELING_LABELS[emotion],
      );
    },
  );
  it("uses the primary feeling within the dominant average group", () => {
    const result = buildEmotionPresentation({
      fear: 30,
      curiosity: 20,
      optimism: 20,
      desire: 20,
    });
    expect(result.dominantGroup).toBe("drive");
    expect(result.feeling).toEqual(FEELING_LABELS.desire);
    expect(
      result.groups.find((group) => group.group === "alarm")?.average,
    ).toBe(10);
  });
  it("preserves canonical tie ordering and only three active groups", () => {
    const result = buildEmotionPresentation({
      admiration: 9,
      respect: 9,
      amusement: 9,
      desire: 9,
    });
    expect(result.topGroups.map((group) => group.group)).toEqual([
      "affection",
      "esteem",
      "delight",
    ]);
    expect(result.feeling).toEqual(FEELING_LABELS.admiration);
    expect(result.groups).toHaveLength(8);
  });
  it("normalizes malformed raw and runtime-shaped values identically", () => {
    const values = {
      joy: "40",
      fear: -2,
      caring: NaN,
      love: "invalid",
      sadness: 1.6,
    };
    expect(buildEmotionPresentation(values)).toEqual(
      buildEmotionPresentation({ values, dominantGroup: "gloom" }),
    );
    expect(buildEmotionPresentation(values).runtime.values).toMatchObject({
      joy: 30,
      fear: 0,
      caring: 0,
      love: 0,
      sadness: 2,
    });
  });
  it.each([undefined, null, [], "sad", {}, { values: [] }])(
    "presents invalid or empty input as neutral: %s",
    (value) => {
      const result = buildEmotionPresentation(value);
      expect(result.dominantGroup).toBe("neutral");
      expect(result.topGroups).toEqual([]);
      expect(result.feeling.label).toBe("Feeling neutral");
    },
  );
  it("formats averages to one decimal place without changing chart precision", () => {
    const average = buildEmotionPresentation({ joy: 1 }).groups.find(
      (group) => group.group === "delight",
    )!.average;
    expect(average).toBe(1 / 3);
    expect(formatEmotionAverage(average)).toBe("0.3");
    expect(formatEmotionAverage(30)).toBe("30");
  });
});
