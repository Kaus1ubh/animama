import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EMOTION_GROUPS, TRACKED_EMOTIONS } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  EMOTION_PALETTE,
  FEELING_LABELS,
  formatEmotionAverage,
} from "./presentation";

describe("emotion presentation", () => {
  it.each([
    ["admiration", "✨", "🤩", "🌟"],
    ["caring", "😊", "😇", "🥰"],
    ["love", "💛", "❤️", "💖"],
    ["respect", "🙌", "👏", "🤝"],
    ["confidence", "😏", "😎", "💪"],
    ["gratitude", "🙏", "🥹", "🥹"],
    ["amusement", "🙂", "😄", "😂"],
    ["excitement", "🙂", "🤗", "🤩"],
    ["joy", "🙂", "😊", "😁"],
    ["desire", "👋", "😣", "🥺"],
    ["curiosity", "🤔", "🧐", "🤓"],
    ["optimism", "🌤️", "☀️", "🌈"],
    ["fear", "😨", "😰", "😱"],
    ["nervousness", "😧", "😰", "🤢"],
    ["confusion", "😕", "🫨", "😵‍💫"],
    ["anger", "😒", "😠", "😡"],
    ["annoyance", "😑", "🫩", "😤"],
    ["disapproval", "🤨", "😑", "😠"],
    ["disgust", "😖", "🤢", "🤮"],
    ["embarrassment", "🫣", "😳", "🫪"],
    ["remorse", "😔", "😓", "😣"],
    ["disappointment", "😞", "😓", "😩"],
    ["grief", "😔", "💔", "💔"],
    ["sadness", "🙁", "😢", "😭"],
  ])(
    "uses approved intensity emojis for %s",
    (emotion, slightly, plain, very) => {
      for (const [score, emoji] of [
        [1, slightly],
        [15, slightly],
        [16, plain],
        [25, plain],
        [26, very],
        [30, very],
      ] as const) {
        expect(
          buildEmotionPresentation({ [emotion]: score }).feeling.emoji,
        ).toBe(emoji);
      }
    },
  );

  it("covers every group, tracked feeling and neutral", () => {
    expect(Object.keys(EMOTION_PALETTE)).toHaveLength(9);
    for (const group of [...EMOTION_GROUPS, "neutral" as const])
      expect(EMOTION_PALETTE[group]).toBeTruthy();
    expect(Object.keys(FEELING_LABELS)).toHaveLength(24);
    for (const emotion of TRACKED_EMOTIONS) {
      expect(FEELING_LABELS[emotion].label).toMatch(/^Feeling /);
      expect(FEELING_LABELS[emotion].emojis.plain).toBeTruthy();
    }
  });
  it.each(TRACKED_EMOTIONS)(
    "resolves an active %s to its mapped feeling",
    (emotion) => {
      expect(buildEmotionPresentation({ [emotion]: 12 }).feeling).toEqual({
        emoji: FEELING_LABELS[emotion].emojis.slightly,
        mascot: `/emotions/${emotion}-slightly.webp`,
        label: FEELING_LABELS[emotion].label.replace(
          "Feeling ",
          "Feeling slightly ",
        ),
      });
    },
  );
  it.each([
    [0, "Feeling neutral", "😐"],
    [1, "Feeling slightly joyful", "🙂"],
    [15, "Feeling slightly joyful", "🙂"],
    [16, "Feeling joyful", "😊"],
    [25, "Feeling joyful", "😊"],
    [26, "Feeling very joyful", "😁"],
    [30, "Feeling very joyful", "😁"],
  ])("formats the feeling intensity boundary %s", (value, label, emoji) => {
    expect(buildEmotionPresentation({ joy: value }).feeling).toMatchObject({
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
    expect(result.feeling).toEqual({
      label: "Feeling longing",
      emoji: "😣",
      mascot: "/emotions/desire-plain.webp",
    });
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
      emoji: "✨",
      label: "Feeling slightly admiring",
      mascot: "/emotions/admiration-slightly.webp",
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

describe("emotion mascots", () => {
  it("resolves intensity boundaries and neutral to mascot images", () => {
    expect(buildEmotionPresentation({}).feeling.mascot).toBe(
      "/emotions/neutral.webp",
    );
    expect(buildEmotionPresentation({ joy: 15 }).feeling.mascot).toBe(
      "/emotions/joy-slightly.webp",
    );
    expect(buildEmotionPresentation({ joy: 16 }).feeling.mascot).toBe(
      "/emotions/joy-plain.webp",
    );
    expect(buildEmotionPresentation({ joy: 26 }).feeling.mascot).toBe(
      "/emotions/joy-very.webp",
    );
  });

  it("ships an image for every emotion, intensity and neutral", async () => {
    const files = [
      "neutral",
      ...TRACKED_EMOTIONS.flatMap((emotion) =>
        (["slightly", "plain", "very"] as const).map(
          (intensity) => `${emotion}-${intensity}`,
        ),
      ),
    ];
    await Promise.all(
      files.map((file) =>
        access(
          new URL(`../../../public/emotions/${file}.webp`, import.meta.url),
        ),
      ),
    );
  });
});
