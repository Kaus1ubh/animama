export const EMOTION_GROUPS = [
  "affection",
  "esteem",
  "delight",
  "drive",
  "alarm",
  "rejection",
  "revulsion",
  "gloom",
] as const;

export const EMOTION_GROUP_MEMBERS = {
  affection: ["admiration", "caring", "love"],
  esteem: ["respect", "confidence", "gratitude"],
  delight: ["amusement", "excitement", "joy"],
  drive: ["desire", "curiosity", "optimism"],
  alarm: ["fear", "nervousness", "confusion"],
  rejection: ["anger", "annoyance", "disapproval"],
  revulsion: ["disgust", "embarrassment", "remorse"],
  gloom: ["disappointment", "grief", "sadness"],
} as const;

export const TRACKED_EMOTIONS = [
  "admiration",
  "caring",
  "love",
  "respect",
  "confidence",
  "gratitude",
  "amusement",
  "excitement",
  "joy",
  "desire",
  "curiosity",
  "optimism",
  "fear",
  "nervousness",
  "confusion",
  "anger",
  "annoyance",
  "disapproval",
  "disgust",
  "embarrassment",
  "remorse",
  "disappointment",
  "grief",
  "sadness",
] as const;

export const EMOTION_MIN_VALUE = 0;
export const EMOTION_MAX_VALUE = 30;

export type EmotionGroup = (typeof EMOTION_GROUPS)[number];
export type ResolvedEmotionGroup = EmotionGroup | "neutral";
export type TrackedEmotion = (typeof TRACKED_EMOTIONS)[number];
export type EmotionIntensity = 0 | 1 | 2 | 3;
export type VoiceEmotionKey = "neutral" | "joy" | "sad" | "angry";

export type EmotionValue = {
  emotion: TrackedEmotion;
  value: number;
};

export type EmotionStateMap = Record<TrackedEmotion, number>;

export type RankedEmotion = {
  emotion: TrackedEmotion;
  value: number;
  intensity: EmotionIntensity;
  group: EmotionGroup;
};

export type EmotionGroupSummary = {
  group: EmotionGroup;
  average: number;
  intensity: EmotionIntensity;
  primaryEmotion: RankedEmotion | null;
  emotions: RankedEmotion[];
};

export type EmotionRuntimeState = {
  values: EmotionStateMap;
  rankedEmotions: RankedEmotion[];
  rankedGroups: EmotionGroupSummary[];
  dominantEmotion: RankedEmotion | null;
  dominantGroup: ResolvedEmotionGroup;
  dominantGroupSummary: EmotionGroupSummary | null;
};

const TRACKED_EMOTION_SET = new Set<string>(TRACKED_EMOTIONS);
const EMOTION_GROUP_SET = new Set<string>(EMOTION_GROUPS);
const TRACKED_EMOTION_ORDER = new Map(
  TRACKED_EMOTIONS.map((emotion, index) => [emotion, index]),
);
const EMOTION_GROUP_ORDER = new Map(
  EMOTION_GROUPS.map((group, index) => [group, index]),
);

const EMOTION_GROUP_BY_EMOTION = Object.fromEntries(
  EMOTION_GROUPS.flatMap((group) =>
    EMOTION_GROUP_MEMBERS[group].map((emotion) => [emotion, group]),
  ),
) as Record<TrackedEmotion, EmotionGroup>;

const MANIFEST_LANES: Record<EmotionGroup | "neutral", string> = {
  neutral: "neutral",
  affection: "neutral",
  esteem: "neutral",
  delight: "joy",
  drive: "joy",
  alarm: "fear",
  rejection: "angry",
  revulsion: "disgust",
  gloom: "sad",
};

const VOICE_LANES: Record<EmotionGroup | "neutral", VoiceEmotionKey> = {
  neutral: "neutral",
  affection: "joy",
  esteem: "joy",
  delight: "joy",
  drive: "joy",
  alarm: "angry",
  rejection: "angry",
  revulsion: "angry",
  gloom: "sad",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampEmotionValue(value: number): number {
  if (!Number.isFinite(value)) return EMOTION_MIN_VALUE;
  return Math.max(
    EMOTION_MIN_VALUE,
    Math.min(EMOTION_MAX_VALUE, Math.round(value)),
  );
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sortRankedEmotion(a: RankedEmotion, b: RankedEmotion): number {
  if (b.value !== a.value) return b.value - a.value;
  return (
    (TRACKED_EMOTION_ORDER.get(a.emotion) ?? Number.MAX_SAFE_INTEGER) -
    (TRACKED_EMOTION_ORDER.get(b.emotion) ?? Number.MAX_SAFE_INTEGER)
  );
}

function sortEmotionValues(a: EmotionValue, b: EmotionValue): number {
  if (b.value !== a.value) return b.value - a.value;
  return (
    (TRACKED_EMOTION_ORDER.get(a.emotion) ?? Number.MAX_SAFE_INTEGER) -
    (TRACKED_EMOTION_ORDER.get(b.emotion) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function createEmptyEmotionStateMap(): EmotionStateMap {
  return TRACKED_EMOTIONS.reduce((acc, emotion) => {
    acc[emotion] = EMOTION_MIN_VALUE;
    return acc;
  }, {} as EmotionStateMap);
}

export function isTrackedEmotion(value: unknown): value is TrackedEmotion {
  return typeof value === "string" && TRACKED_EMOTION_SET.has(value);
}

export function isEmotionGroup(value: unknown): value is EmotionGroup {
  return typeof value === "string" && EMOTION_GROUP_SET.has(value);
}

export function groupForEmotion(
  emotion: TrackedEmotion | null | undefined,
): EmotionGroup | null {
  if (!emotion) return null;
  return EMOTION_GROUP_BY_EMOTION[emotion] ?? null;
}

export function manifestEmotionForGroup(
  group: EmotionGroup | "neutral" | null | undefined,
): string {
  if (!group) return "neutral";
  return MANIFEST_LANES[group] ?? "neutral";
}

export function voiceEmotionForGroup(
  group: EmotionGroup | "neutral" | null | undefined,
): VoiceEmotionKey {
  if (!group) return "neutral";
  return VOICE_LANES[group] ?? "neutral";
}

export function intensityFromEmotionValue(value: number): EmotionIntensity {
  if (value >= 26) return 3;
  if (value >= 16) return 2;
  if (value >= 5) return 1;
  return 0;
}

export function orderedEmotionValues(values: EmotionStateMap): EmotionValue[] {
  return TRACKED_EMOTIONS.map((emotion) => ({
    emotion,
    value: clampEmotionValue(values[emotion]),
  }));
}

export function rankEmotionState(values: EmotionStateMap): RankedEmotion[] {
  return orderedEmotionValues(values)
    .filter((entry) => entry.value > 0)
    .sort(sortEmotionValues)
    .map((entry) => ({
      emotion: entry.emotion,
      value: entry.value,
      intensity: intensityFromEmotionValue(entry.value),
      group: groupForEmotion(entry.emotion) ?? "affection",
    }));
}

export function rankEmotionGroups(
  values: EmotionStateMap,
): EmotionGroupSummary[] {
  const normalizedValues = normalizeEmotionStateMap(values);
  const grouped = EMOTION_GROUPS.map((group) => {
    const emotions = EMOTION_GROUP_MEMBERS[group]
      .map((emotion) => ({
        emotion,
        value: clampEmotionValue(normalizedValues[emotion]),
        intensity: intensityFromEmotionValue(normalizedValues[emotion]),
        group,
      }))
      .sort(sortRankedEmotion);
    const average =
      emotions.reduce((sum, emotion) => sum + emotion.value, 0) /
      emotions.length;
    const primaryEmotion =
      emotions.find((emotion) => emotion.value > 0) ?? null;
    return {
      group,
      average,
      intensity: primaryEmotion?.intensity ?? 0,
      primaryEmotion,
      emotions,
    } satisfies EmotionGroupSummary;
  })
    .filter((entry) => entry.average > 0)
    .sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      return (
        (EMOTION_GROUP_ORDER.get(a.group) ?? Number.MAX_SAFE_INTEGER) -
        (EMOTION_GROUP_ORDER.get(b.group) ?? Number.MAX_SAFE_INTEGER)
      );
    });

  return grouped;
}

export function buildEmotionRuntimeState(
  values: EmotionStateMap,
): EmotionRuntimeState {
  const normalizedValues = normalizeEmotionStateMap(values);
  const rankedEmotions = rankEmotionState(normalizedValues);
  const rankedGroups = rankEmotionGroups(normalizedValues);
  const dominantGroupSummary = rankedGroups[0] ?? null;
  return {
    values: normalizedValues,
    rankedEmotions,
    rankedGroups,
    dominantEmotion: rankedEmotions[0] ?? null,
    dominantGroup: dominantGroupSummary?.group ?? "neutral",
    dominantGroupSummary,
  };
}

export function normalizeEmotionStateMap(source: unknown): EmotionStateMap {
  const next = createEmptyEmotionStateMap();
  if (!isRecord(source)) {
    return next;
  }

  for (const emotion of TRACKED_EMOTIONS) {
    next[emotion] = clampEmotionValue(toFiniteNumber(source[emotion]));
  }

  return next;
}

export function emotionStateFromValues(source: unknown): EmotionStateMap {
  const next = createEmptyEmotionStateMap();
  if (!Array.isArray(source)) {
    return next;
  }

  for (const item of source) {
    if (!isRecord(item)) continue;
    const emotion = item.emotion;
    if (!isTrackedEmotion(emotion)) continue;
    next[emotion] = clampEmotionValue(toFiniteNumber(item.value));
  }

  return next;
}

export function formatTrackedEmotionLabel(emotion: TrackedEmotion): string {
  return emotion
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatEmotionGroupLabel(group: EmotionGroup): string {
  return group.charAt(0).toUpperCase() + group.slice(1);
}
