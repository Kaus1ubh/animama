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
  { label: string; emojis: Record<"slightly" | "plain" | "very", string> }
> = {
  admiration: {
    label: "Feeling admiring",
    emojis: { slightly: "✨", plain: "🤩", very: "🌟" },
  },
  caring: {
    label: "Feeling caring",
    emojis: { slightly: "😊", plain: "😇", very: "🥰" },
  },
  love: {
    label: "Feeling loving",
    emojis: { slightly: "💛", plain: "❤️", very: "💖" },
  },
  respect: {
    label: "Feeling respectful",
    emojis: { slightly: "🙌", plain: "👏", very: "🤝" },
  },
  confidence: {
    label: "Feeling confident",
    emojis: { slightly: "😏", plain: "😎", very: "💪" },
  },
  gratitude: {
    label: "Feeling grateful",
    emojis: { slightly: "🙏", plain: "🥹", very: "🥹" },
  },
  amusement: {
    label: "Feeling amused",
    emojis: { slightly: "🙂", plain: "😄", very: "😂" },
  },
  excitement: {
    label: "Feeling excited",
    emojis: { slightly: "🙂", plain: "🤗", very: "🤩" },
  },
  joy: {
    label: "Feeling joyful",
    emojis: { slightly: "🙂", plain: "😊", very: "😁" },
  },
  desire: {
    label: "Feeling longing",
    emojis: { slightly: "👋", plain: "😣", very: "🥺" },
  },
  curiosity: {
    label: "Feeling curious",
    emojis: { slightly: "🤔", plain: "🧐", very: "🤓" },
  },
  optimism: {
    label: "Feeling optimistic",
    emojis: { slightly: "🌤️", plain: "☀️", very: "🌈" },
  },
  fear: {
    label: "Feeling afraid",
    emojis: { slightly: "😨", plain: "😰", very: "😱" },
  },
  nervousness: {
    label: "Feeling nervous",
    emojis: { slightly: "😧", plain: "😰", very: "🤢" },
  },
  confusion: {
    label: "Feeling confused",
    emojis: { slightly: "😕", plain: "🫨", very: "😵‍💫" },
  },
  anger: {
    label: "Feeling angry",
    emojis: { slightly: "😒", plain: "😠", very: "😡" },
  },
  annoyance: {
    label: "Feeling annoyed",
    emojis: { slightly: "😑", plain: "🫩", very: "😤" },
  },
  disapproval: {
    label: "Feeling disapproving",
    emojis: { slightly: "🤨", plain: "😑", very: "😠" },
  },
  disgust: {
    label: "Feeling disgusted",
    emojis: { slightly: "😖", plain: "🤢", very: "🤮" },
  },
  embarrassment: {
    label: "Feeling embarrassed",
    emojis: { slightly: "🫣", plain: "😳", very: "🫪" },
  },
  remorse: {
    label: "Feeling remorseful",
    emojis: { slightly: "😔", plain: "😓", very: "😣" },
  },
  disappointment: {
    label: "Feeling disappointed",
    emojis: { slightly: "😞", plain: "😓", very: "😩" },
  },
  grief: {
    label: "Feeling grieving",
    emojis: { slightly: "😔", plain: "💔", very: "💔" },
  },
  sadness: {
    label: "Feeling sad",
    emojis: { slightly: "🙁", plain: "😢", very: "😭" },
  },
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
  const baseFeeling = primary ? FEELING_LABELS[primary.emotion] : null;
  const intensity =
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
    feeling: baseFeeling
      ? {
          emoji: baseFeeling.emojis[intensity],
          label: baseFeeling.label.replace(
            "Feeling ",
            intensity === "plain" ? "Feeling " : `Feeling ${intensity} `,
          ),
        }
      : { label: "Feeling neutral", emoji: "😐" },
  };
}

/** Detail-only numeric copy; chart values retain their unrounded averages. */
export function formatEmotionAverage(value: number): string {
  return Number(value.toFixed(1)).toString();
}
