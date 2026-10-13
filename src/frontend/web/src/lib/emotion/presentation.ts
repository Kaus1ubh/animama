import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";
import type { LocaleFormatters } from "@animama/product-ui/i18n";

import {
  EMOTION_GROUP_MEMBERS,
  EMOTION_GROUPS,
  TRACKED_EMOTIONS,
  buildEmotionRuntimeState,
  normalizeEmotionStateMap,
  type ResolvedEmotionGroup,
  type TrackedEmotion,
} from "@/lib/emotion";

/**
 * Local copies of the domain's emotion and group names. Display labels come
 * from the `emotion` catalog, and catalog extraction expands each key from
 * these unions; `presentation.test.ts` checks they match the domain lists.
 */
export type EmotionName =
  | "admiration"
  | "caring"
  | "love"
  | "respect"
  | "confidence"
  | "gratitude"
  | "amusement"
  | "excitement"
  | "joy"
  | "desire"
  | "curiosity"
  | "optimism"
  | "fear"
  | "nervousness"
  | "confusion"
  | "anger"
  | "annoyance"
  | "disapproval"
  | "disgust"
  | "embarrassment"
  | "remorse"
  | "disappointment"
  | "grief"
  | "sadness";
export type EmotionGroupName =
  | "affection"
  | "esteem"
  | "delight"
  | "drive"
  | "alarm"
  | "rejection"
  | "revulsion"
  | "gloom";
/** How strongly the primary emotion is felt; each has its own wording. */
export type FeelingIntensity = "slightly" | "plain" | "very";

/** Shared UI palette; domain emotion and voice mappings remain unchanged. */
export const EMOTION_PALETTE: Record<ResolvedEmotionGroup, string> = {
  affection: "#C77D86",
  esteem: "#479C95",
  delight: "#D5A23F",
  drive: "#7F9D70",
  alarm: "#D9824B",
  rejection: "#C65D69",
  revulsion: "#9276B5",
  gloom: "#648BC0",
  neutral: "#8A9099",
};

/** Emoji for each tracked feeling at each intensity. */
export const FEELING_EMOJIS: Record<
  EmotionName,
  Record<FeelingIntensity, string>
> = {
  admiration: { slightly: "✨", plain: "🤩", very: "🌟" },
  caring: { slightly: "😊", plain: "😇", very: "🥰" },
  love: { slightly: "💛", plain: "❤️", very: "💖" },
  respect: { slightly: "🙌", plain: "👏", very: "🤝" },
  confidence: { slightly: "😏", plain: "😎", very: "💪" },
  gratitude: { slightly: "🙏", plain: "🥹", very: "🥹" },
  amusement: { slightly: "🙂", plain: "😄", very: "😂" },
  excitement: { slightly: "🙂", plain: "🤗", very: "🤩" },
  joy: { slightly: "🙂", plain: "😊", very: "😁" },
  desire: { slightly: "👋", plain: "😣", very: "🥺" },
  curiosity: { slightly: "🤔", plain: "🧐", very: "🤓" },
  optimism: { slightly: "🌤️", plain: "☀️", very: "🌈" },
  fear: { slightly: "😨", plain: "😰", very: "😱" },
  nervousness: { slightly: "😧", plain: "😰", very: "🤢" },
  confusion: { slightly: "😕", plain: "🫨", very: "😵‍💫" },
  anger: { slightly: "😒", plain: "😠", very: "😡" },
  annoyance: { slightly: "😑", plain: "🫩", very: "😤" },
  disapproval: { slightly: "🤨", plain: "😑", very: "😠" },
  disgust: { slightly: "😖", plain: "🤢", very: "🤮" },
  embarrassment: { slightly: "🫣", plain: "😳", very: "🫪" },
  remorse: { slightly: "😔", plain: "😓", very: "😣" },
  disappointment: { slightly: "😞", plain: "😓", very: "😩" },
  grief: { slightly: "😔", plain: "💔", very: "💔" },
  sadness: { slightly: "🙁", plain: "😢", very: "😭" },
};

/** The `emotion` translator for the active UI Locale, for callers without a hook. */
function activeEmotionT(): TFunction<"emotion"> {
  return getI18n().getFixedT(null, "emotion");
}

/** Display name of a tracked emotion. */
export function emotionLabel(
  emotion: EmotionName,
  t: TFunction<"emotion"> = activeEmotionT(),
): string {
  return t(`emotions.${emotion}`);
}

/** Display name of a saved emotion value; a value outside the tracked emotions shows as saved. */
export function storedEmotionLabel(
  emotion: string,
  t: TFunction<"emotion"> = activeEmotionT(),
): string {
  return (TRACKED_EMOTIONS as readonly string[]).includes(emotion)
    ? emotionLabel(emotion as TrackedEmotion, t)
    : emotion;
}

/** Display name of an emotion group. */
export function emotionGroupLabel(
  group: EmotionGroupName,
  t: TFunction<"emotion"> = activeEmotionT(),
): string {
  return t(`groups.${group}`);
}

/** "Feeling slightly joyful" and its translations, for one emotion and intensity. */
export function feelingLabel(
  emotion: EmotionName,
  intensity: FeelingIntensity,
  t: TFunction<"emotion"> = activeEmotionT(),
): string {
  return t(`feelings.${emotion}.${intensity}`);
}

/**
 * Normalize either a raw values map or runtime envelope using the domain rules.
 *
 * Labels are display text only. Components pass their `t` so labels follow a
 * locale switch; other callers get the active UI Locale. Code and requests use
 * the domain names (`group`, `emotion`, `dominantGroup`), never the labels.
 */
export function buildEmotionPresentation(
  value: unknown,
  t: TFunction<"emotion"> = activeEmotionT(),
) {
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "values" in value
      ? value.values
      : value;
  const runtime = buildEmotionRuntimeState(normalizeEmotionStateMap(source));
  const groups = EMOTION_GROUPS.map((group) => {
    const emotions = EMOTION_GROUP_MEMBERS[group].map(
      (emotion: TrackedEmotion) => ({
        emotion,
        label: emotionLabel(emotion, t),
        value: runtime.values[emotion],
      }),
    );
    return {
      group,
      label: emotionGroupLabel(group, t),
      color: EMOTION_PALETTE[group],
      maximum: Math.max(...emotions.map((emotion) => emotion.value)),
      average:
        emotions.reduce((sum, emotion) => sum + emotion.value, 0) /
        emotions.length,
      emotions,
    };
  });
  const topGroups = runtime.rankedGroups
    .slice(0, 3)
    .map((summary) => groups.find((group) => group.group === summary.group)!);
  const primary = runtime.dominantGroupSummary?.primaryEmotion;
  const intensity: FeelingIntensity =
    primary && primary.value <= 15
      ? "slightly"
      : primary && primary.value >= 26
        ? "very"
        : "plain";
  return {
    runtime,
    groups,
    topGroups,
    dominantGroup: runtime.dominantGroup,
    color: EMOTION_PALETTE[runtime.dominantGroup],
    feeling: primary
      ? {
          emoji: FEELING_EMOJIS[primary.emotion][intensity],
          label: feelingLabel(primary.emotion, intensity, t),
        }
      : { label: t("feelings.neutral"), emoji: "😐" },
  };
}

/** Detail-only numeric copy; chart values retain their unrounded averages. */
export function formatEmotionAverage(
  value: number,
  formatters: Pick<LocaleFormatters, "number">,
): string {
  return formatters.number(value, { maximumFractionDigits: 1 });
}
