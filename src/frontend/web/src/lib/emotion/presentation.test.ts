import { afterEach, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { createFormatters } from "@animama/product-ui/i18n";
import { EMOTION_GROUPS, TRACKED_EMOTIONS } from "@/lib/emotion";
import {
  buildEmotionPresentation,
  EMOTION_PALETTE,
  FEELING_EMOJIS,
  feelingLabel,
  formatEmotionAverage,
  storedEmotionLabel,
} from "./presentation";

describe("emotion presentation", () => {
  it("labels a saved tracked emotion and keeps any other saved value", () => {
    const t = getI18n().getFixedT(null, "emotion");
    expect(storedEmotionLabel("joy")).toBe(t("emotions.joy"));
    expect(storedEmotionLabel("wistful")).toBe("wistful");
  });

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
    expect(Object.keys(FEELING_EMOJIS)).toHaveLength(24);
    for (const emotion of TRACKED_EMOTIONS) {
      expect(feelingLabel(emotion, "plain")).toMatch(/^Feeling /);
      expect(FEELING_EMOJIS[emotion].plain).toBeTruthy();
    }
  });
  it("labels exactly the domain's emotions and groups", () => {
    // The local name unions in presentation.ts must match the domain lists.
    const catalog = getI18n().getResourceBundle("en", "emotion") as Record<
      "emotions" | "groups" | "feelings",
      Record<string, unknown>
    >;
    const sorted = (values: Iterable<string>) => [...values].sort();
    expect(sorted(Object.keys(catalog.emotions))).toEqual(
      sorted(TRACKED_EMOTIONS),
    );
    expect(sorted(Object.keys(catalog.groups))).toEqual(sorted(EMOTION_GROUPS));
    expect(sorted(Object.keys(catalog.feelings))).toEqual(
      sorted([...TRACKED_EMOTIONS, "neutral"]),
    );
  });
  it.each(TRACKED_EMOTIONS)(
    "resolves an active %s to its mapped feeling",
    (emotion) => {
      const feeling = buildEmotionPresentation({ [emotion]: 12 }).feeling;
      expect(feeling).toEqual({
        emoji: FEELING_EMOJIS[emotion].slightly,
        label: feelingLabel(emotion, "slightly"),
      });
      expect(feeling.label).toMatch(/^Feeling slightly /);
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
    expect(result.feeling).toEqual({ label: "Feeling longing", emoji: "😣" });
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
    const english = createFormatters("en");
    expect(formatEmotionAverage(average, english)).toBe("0.3");
    expect(formatEmotionAverage(30, english)).toBe("30");
  });

  describe("in another UI Locale", () => {
    afterEach(async () => {
      await getI18n().changeLanguage("en");
    });

    it("translates labels only; domain names stay the same", async () => {
      const english = buildEmotionPresentation({ joy: 30, fear: 3 });
      await getI18n().changeLanguage("ja");
      const japanese = buildEmotionPresentation({ joy: 30, fear: 3 });
      expect(japanese.feeling.label).toBe(
        getI18n().t("emotion:feelings.joy.very"),
      );
      expect(japanese.feeling.label).not.toBe(english.feeling.label);
      expect(japanese.groups.map((group) => group.label)).not.toEqual(
        english.groups.map((group) => group.label),
      );
      // Code and requests use the domain names, which never follow the locale.
      expect(japanese.dominantGroup).toBe(english.dominantGroup);
      expect(japanese.groups.map((group) => group.group)).toEqual(
        english.groups.map((group) => group.group),
      );
      expect(japanese.runtime).toEqual(english.runtime);
      expect(japanese.feeling.emoji).toBe(english.feeling.emoji);
    });
  });
});
