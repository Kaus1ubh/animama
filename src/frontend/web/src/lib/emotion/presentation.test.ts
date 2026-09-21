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
      expect(buildEmotionPresentation({ [emotion]: 12 }).feeling).toEqual({
        ...FEELING_LABELS[emotion],
        label: FEELING_LABELS[emotion].label.replace(
          "Feeling ",
          "Feeling slightly ",
        ),
      });
    },
  );
  it.each([
    [0, "Feeling neutral", "😐"],
    [1, "Feeling slightly joyful", "😊"],
    [15, "Feeling slightly joyful", "😊"],
    [16, "Feeling joyful", "😊"],
    [25, "Feeling joyful", "😊"],
    [26, "Feeling very joyful", "😊"],
    [30, "Feeling very joyful", "😊"],
  ])("formats the feeling intensity boundary %s", (value, label, emoji) => {
    expect(buildEmotionPresentation({ joy: value }).feeling).toEqual({
      label,
      emoji,
    });
  });
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
  it("exposes each group's maximum without changing average-based ranking", () => {
    const result = buildEmotionPresentation({
      fear: 30,
      desire: 20,
      curiosity: 20,
      optimism: 20,
    });
    expect(
      result.groups.find((group) => group.group === "alarm"),
    ).toMatchObject({ average: 10, maximum: 30 });
    expect(
      result.groups.find((group) => group.group === "drive"),
    ).toMatchObject({ average: 20, maximum: 20 });
    expect(result.dominantGroup).toBe("drive");
    expect(result.topGroups.map((group) => group.group)).toEqual([
      "drive",
      "alarm",
    ]);
  });
  it("computes maxima after normalization, including zero groups", () => {
    const result = buildEmotionPresentation({
      fear: "40",
      confusion: -5,
      nervousness: NaN,
      joy: 1.6,
    });
    expect(
      result.groups.find((group) => group.group === "alarm")?.maximum,
    ).toBe(30);
    expect(
      result.groups.find((group) => group.group === "delight")?.maximum,
    ).toBe(2);
    expect(
      result.groups.find((group) => group.group === "gloom")?.maximum,
    ).toBe(0);
    expect(
      buildEmotionPresentation(null).groups.every(
        (group) => group.maximum === 0,
      ),
    ).toBe(true);
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
    expect(result.feeling).toEqual({
      ...FEELING_LABELS.admiration,
      label: "Feeling slightly admiring",
    });
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
