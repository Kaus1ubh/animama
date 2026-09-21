import {
  EMOTION_GROUP_MEMBERS,
  EMOTION_GROUPS,
  buildEmotionRuntimeState,
  formatEmotionGroupLabel,
  formatTrackedEmotionLabel,
  normalizeEmotionStateMap,
  type ResolvedEmotionGroup,
  type TrackedEmotion,
} from "@/lib/emotion";

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
export const FEELING_LABELS: Record<
  TrackedEmotion,
  { label: string; emoji: string }
> = {
  admiration: { label: "Feeling admiring", emoji: "🤩" },
  caring: { label: "Feeling caring", emoji: "🥰" },
  love: { label: "Feeling loving", emoji: "❤️" },
  respect: { label: "Feeling respectful", emoji: "🤝" },
  confidence: { label: "Feeling confident", emoji: "😎" },
  gratitude: { label: "Feeling grateful", emoji: "🙏" },
  amusement: { label: "Feeling amused", emoji: "😄" },
  excitement: { label: "Feeling excited", emoji: "🤗" },
  joy: { label: "Feeling joyful", emoji: "😊" },
  desire: { label: "Feeling longing", emoji: "💭" },
  curiosity: { label: "Feeling curious", emoji: "🤔" },
  optimism: { label: "Feeling optimistic", emoji: "🌤️" },
  fear: { label: "Feeling afraid", emoji: "😨" },
  nervousness: { label: "Feeling nervous", emoji: "😟" },
  confusion: { label: "Feeling confused", emoji: "😕" },
  anger: { label: "Feeling angry", emoji: "😠" },
  annoyance: { label: "Feeling annoyed", emoji: "😒" },
  disapproval: { label: "Feeling disapproving", emoji: "👎" },
  disgust: { label: "Feeling disgusted", emoji: "🤢" },
  embarrassment: { label: "Feeling embarrassed", emoji: "😳" },
  remorse: { label: "Feeling remorseful", emoji: "😔" },
  disappointment: { label: "Feeling disappointed", emoji: "😞" },
  grief: { label: "Feeling grieving", emoji: "💔" },
  sadness: { label: "Feeling sad", emoji: "😢" },
};

/** Normalize either a raw values map or runtime envelope using the domain rules. */
export function buildEmotionPresentation(value: unknown) {
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "values" in value
      ? value.values
      : value;
  const runtime = buildEmotionRuntimeState(normalizeEmotionStateMap(source));
  const groups = EMOTION_GROUPS.map((group) => {
    const emotions = EMOTION_GROUP_MEMBERS[group].map((emotion) => ({
      emotion,
      label: formatTrackedEmotionLabel(emotion),
      value: runtime.values[emotion],
    }));
    return {
      group,
      label: formatEmotionGroupLabel(group),
      color: EMOTION_PALETTE[group],
      average:
        emotions.reduce((sum, emotion) => sum + emotion.value, 0) /
        emotions.length,
      emotions,
    };
  });
  const topGroups = runtime.rankedGroups
    .slice(0, 3)
    .map((summary) => groups.find((group) => group.group === summary.group)!);
  const primary = runtime.dominantGroupSummary?.primaryEmotion?.emotion;
  return {
    runtime,
    groups,
    topGroups,
    dominantGroup: runtime.dominantGroup,
    color: EMOTION_PALETTE[runtime.dominantGroup],
    feeling: primary
      ? FEELING_LABELS[primary]
      : { label: "Feeling neutral", emoji: "😐" },
  };
}

/** Detail-only numeric copy; chart values retain their unrounded averages. */
export function formatEmotionAverage(value: number): string {
  return Number(value.toFixed(1)).toString();
}
