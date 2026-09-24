import rawManifest from "@/assets/vrm/animations/manifest.json";
import {
  TRACKED_EMOTIONS,
  intensityFromEmotionValue,
  isTrackedEmotion,
  type EmotionIntensity,
  type EmotionRuntimeState,
  type TrackedEmotion,
} from "@/lib/emotion";
import type { AnimationLoopType } from "./types";

export type ManifestGestureType = "vrma" | "animaPoseClip";
export type ManifestAnimationRole = "idle" | "gesture";
export type ManifestIntensityKey = "1" | "2" | "3";
export type ManifestEmotionWeights = Record<ManifestIntensityKey, number>;

export type ManifestAnimationEntry = {
  id?: string;
  name: string;
  file: string;
  type: string;
  description?: string;
  disabled?: boolean;
  loop_type?: string;
  emotions: Partial<Record<TrackedEmotion, ManifestEmotionWeights>>;
  base_pose?: string;
  animation_type: string;
  duration?: number;
  blend_mode?: string;
  loop_count?: number;
  time_scale?: number;
  weight?: number;
  /** Admitted finite Gesture playback, separate from the AI Gesture loadout. */
  idle_playback?: boolean;
};

export type ManifestAnimation = ManifestAnimationEntry;

export type ManifestAnimationInventoryItem = ManifestAnimation & {
  source: ManifestAnimationRole;
  disabled: boolean;
};

export type ManifestGestureEntry = {
  id: string;
  name: string;
  description: string;
  type: ManifestGestureType;
  file: string;
  duration?: number;
  loopType: AnimationLoopType;
  loopCount?: number;
  timeScale: number;
  entry: ManifestAnimation;
};

export type ManifestIdleCandidateDebug = {
  key: string;
  name: string;
  file: string;
  type: string;
  disabled: boolean;
  eligible: boolean;
  neutral: boolean;
  matchedEmotion: TrackedEmotion | null;
  matchedLevel: EmotionIntensity | null;
  weight: number;
  exclusionReason: string | null;
  loopType: AnimationLoopType;
  loopCount?: number;
  durationSec: number | null;
  timeScale: number;
  effectiveDurationSec: number | null;
};

export type ManifestIdleCandidate = ManifestIdleCandidateDebug & {
  entry: ManifestAnimation;
  eligible: true;
  weight: number;
  exclusionReason: null;
  effectiveDurationSec: number;
};

export type ManifestIdleCandidateEvaluation = {
  candidates: ManifestIdleCandidateDebug[];
  eligibleCandidates: ManifestIdleCandidate[];
  eligibleCount: number;
};

export type ManifestIdleSelectionResult = ManifestIdleCandidateEvaluation & {
  selected: ManifestIdleCandidate | null;
};

type ManifestRoot = {
  Animations?: {
    idle?: unknown[];
    gesture?: unknown[];
  };
};

const MANIFEST = rawManifest as ManifestRoot;
const MANIFEST_IDLE_ENTRIES = parseManifestEntries(
  MANIFEST.Animations?.idle,
  "idle",
);
const MANIFEST_GESTURE_ENTRIES = parseManifestGestureEntries(
  parseManifestEntries(MANIFEST.Animations?.gesture, "gesture"),
);
const MANIFEST_GESTURE_INDEX = new Map(
  MANIFEST_GESTURE_ENTRIES.map((entry) => [entry.id, entry]),
);
const MANIFEST_INVENTORY = buildManifestInventory();

export function getManifestIdleEntries(): ManifestAnimation[] {
  return MANIFEST_IDLE_ENTRIES.slice();
}

export function getManifestGestureEntries(): ManifestGestureEntry[] {
  return MANIFEST_GESTURE_ENTRIES.slice();
}

export function getManifestGestureById(
  id: string | null | undefined,
): ManifestGestureEntry | null {
  const normalizedId = normalizeManifestGestureId(id);
  if (!normalizedId) return null;
  return MANIFEST_GESTURE_INDEX.get(normalizedId) ?? null;
}

export function normalizeManifestGestureId(
  id: string | null | undefined,
): string {
  const normalized = normalizeFile(id ?? "");
  return normalized.endsWith("-clip")
    ? normalized.slice(0, -"-clip".length)
    : normalized;
}

export function selectManifestIdleCandidateFromEntries(args: {
  entries: readonly ManifestAnimation[];
  emotionalState: EmotionRuntimeState;
  randomRoll: number;
  previousFile?: string | null;
}): ManifestIdleSelectionResult {
  const evaluation = evaluateManifestIdleEntries(
    args.entries,
    args.emotionalState,
  );
  let pool = evaluation.eligibleCandidates;
  const previousKey = normalizeFile(args.previousFile ?? "");
  if (previousKey && pool.length > 1) {
    const filtered = pool.filter(
      (candidate) => normalizeFile(candidate.file) !== previousKey,
    );
    if (filtered.length > 0) {
      pool = filtered;
    }
  }

  const totalWeight = pool.reduce(
    (sum, candidate) => sum + candidate.weight,
    0,
  );
  if (pool.length === 0 || totalWeight <= 0) {
    return { ...evaluation, selected: null };
  }

  const target = sanitizeRandomRoll(args.randomRoll) * totalWeight;
  let cursor = 0;
  for (const candidate of pool) {
    cursor += candidate.weight;
    if (target < cursor) {
      return { ...evaluation, selected: candidate };
    }
  }

  return { ...evaluation, selected: pool[pool.length - 1] ?? null };
}

export function evaluateManifestIdleEntries(
  entries: readonly ManifestAnimation[],
  emotionalState: EmotionRuntimeState,
): ManifestIdleCandidateEvaluation {
  const candidates = entries.map((entry) =>
    evaluateManifestIdleEntry(entry, emotionalState),
  );
  const eligibleCandidates = candidates.flatMap((candidate, index) => {
    const entry = entries[index];
    if (
      !entry ||
      !candidate.eligible ||
      candidate.exclusionReason !== null ||
      candidate.effectiveDurationSec === null
    ) {
      return [];
    }
    return [
      {
        ...candidate,
        entry,
        eligible: true,
        exclusionReason: null,
        effectiveDurationSec: candidate.effectiveDurationSec,
      } satisfies ManifestIdleCandidate,
    ];
  });
  return {
    candidates,
    eligibleCandidates,
    eligibleCount: eligibleCandidates.length,
  };
}

export function calculateManifestEffectiveDurationSec(
  durationSec: number | null,
  timeScale: number,
  loopType: AnimationLoopType,
  loopCount?: number,
): number | null {
  if (durationSec === null || durationSec <= 0) {
    return null;
  }
  const safeTimeScale = timeScale > 0 ? timeScale : 1;
  const scaledDuration = durationSec / safeTimeScale;

  let repetitions: number;
  switch (loopType) {
    case "once":
      repetitions = 1;
      break;
    case "pingpong":
      repetitions = normalizeLoopCount(loopCount) ?? 2;
      break;
    case "repeat":
      repetitions = normalizeLoopCount(loopCount) ?? Number.POSITIVE_INFINITY;
      break;
    default:
      repetitions = 1;
  }

  if (!Number.isFinite(repetitions)) {
    return null;
  }
  return scaledDuration * repetitions;
}

export function normalizeLoopType(value: unknown): AnimationLoopType {
  if (value === "once" || value === "pingpong" || value === "repeat") {
    return value;
  }
  return "repeat";
}

export function resolveAnimationUrl(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return trimmed;
  const withoutLeadingSlash = trimmed.startsWith("/")
    ? trimmed.slice(1)
    : trimmed;
  const isPublicAnimationPath =
    !trimmed.startsWith("/") ||
    withoutLeadingSlash.startsWith("vrm/animations/");
  if (!isPublicAnimationPath) {
    return ensureVrmaExtension(trimmed);
  }
  const normalized = normalizeFile(trimmed);
  if (!normalized) return "";
  return `/vrm/animations/${ensureVrmaExtension(normalized)}`;
}

export function normalizeFile(file: string): string {
  if (!file) return "";
  const trimmed = file.trim();
  const withoutLeadingSlash = trimmed.startsWith("/")
    ? trimmed.slice(1)
    : trimmed;
  const withoutPrefix = withoutLeadingSlash.replace(/^vrm\/animations\//, "");
  const basename = withoutPrefix.split("/").pop() ?? "";
  const withoutExtension = basename.endsWith(".vrma")
    ? basename.slice(0, -".vrma".length)
    : basename;
  return withoutExtension.replace(/^gesture_/, "");
}

export function getAllAnimations(): ManifestAnimation[] {
  return [...MANIFEST_IDLE_ENTRIES, ...getGestureManifestAnimations()].filter(
    (entry) => !entry.disabled,
  );
}

export function getManifestAnimationInventory(): ManifestAnimationInventoryItem[] {
  return MANIFEST_INVENTORY.slice();
}

function parseManifestEntries(
  entries: unknown[] | undefined,
  animationType: ManifestAnimationRole,
): ManifestAnimation[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => parseManifestEntry(entry, animationType))
    .filter((entry): entry is ManifestAnimation => entry !== null);
}

function parseManifestEntry(
  value: unknown,
  animationType: ManifestAnimationRole,
): ManifestAnimation | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name : "";
  const file = typeof value.file === "string" ? value.file : "";
  const type = typeof value.type === "string" ? value.type : "";
  const entryAnimationType =
    typeof value.animation_type === "string"
      ? value.animation_type
      : animationType;
  return {
    name,
    file,
    id: typeof value.id === "string" ? value.id : undefined,
    type,
    description:
      typeof value.description === "string" ? value.description : undefined,
    disabled: value.disabled === true,
    loop_type:
      typeof value.loop_type === "string" ? value.loop_type : undefined,
    emotions: parseManifestEmotionMap(value.emotions),
    base_pose:
      typeof value.base_pose === "string" ? value.base_pose : undefined,
    animation_type: entryAnimationType,
    duration: toOptionalPositiveNumber(value.duration),
    blend_mode:
      typeof value.blend_mode === "string" ? value.blend_mode : undefined,
    time_scale: toOptionalPositiveNumber(value.time_scale),
    weight: toOptionalNumber(value.weight),
    loop_count: toOptionalPositiveInteger(value.loop_count),
  };
}

function parseManifestGestureEntries(
  entries: readonly ManifestAnimation[],
): ManifestGestureEntry[] {
  const gestures: ManifestGestureEntry[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (entry.disabled === true) continue;
    if (entry.animation_type !== "gesture") continue;
    if (!isManifestGestureType(entry.type)) continue;

    const id = normalizeManifestGestureId(entry.id ?? entry.file);
    if (!id || seenIds.has(id)) continue;

    const name = entry.name || id;
    const description = entry.description ?? "";
    const loopType = normalizeLoopType(entry.loop_type);
    const timeScale = toOptionalPositiveNumber(entry.time_scale) ?? 1;

    gestures.push({
      id,
      name,
      description,
      type: entry.type,
      file: entry.file,
      duration: entry.duration,
      loopType,
      loopCount: toOptionalPositiveInteger(entry.loop_count),
      timeScale,
      entry,
    });
    seenIds.add(id);
  }

  return gestures;
}

function getGestureManifestAnimations(): ManifestAnimation[] {
  return MANIFEST_GESTURE_ENTRIES.map((gesture) => gesture.entry);
}

function buildManifestInventory(): ManifestAnimationInventoryItem[] {
  return [
    ...MANIFEST_IDLE_ENTRIES.map((entry) => ({
      ...entry,
      source: "idle" as const,
      disabled: entry.disabled === true,
    })),
    ...getGestureManifestAnimations().map((entry) => ({
      ...entry,
      source: "gesture" as const,
      disabled: entry.disabled === true,
    })),
  ].sort((a, b) => {
    if (a.disabled !== b.disabled) {
      return a.disabled ? 1 : -1;
    }
    const aLabel = (a.name || a.file || "").toLocaleLowerCase();
    const bLabel = (b.name || b.file || "").toLocaleLowerCase();
    return aLabel.localeCompare(bLabel);
  });
}

function isManifestGestureType(value: string): value is ManifestGestureType {
  return value === "vrma" || value === "animaPoseClip";
}

function evaluateManifestIdleEntry(
  entry: ManifestAnimation,
  emotionalState: EmotionRuntimeState,
): ManifestIdleCandidateDebug {
  const loopType = normalizeLoopType(entry.loop_type);
  const durationSec = toOptionalPositiveNumber(entry.duration) ?? null;
  const timeScale = toOptionalPositiveNumber(entry.time_scale) ?? 1;
  const loopCount = toOptionalPositiveInteger(entry.loop_count);
  const effectiveDurationSec = calculateManifestEffectiveDurationSec(
    durationSec,
    timeScale,
    loopType,
    loopCount,
  );
  const base = {
    key: normalizeFile(entry.file) || entry.name,
    name: entry.name,
    file: entry.file,
    type: entry.type,
    disabled: entry.disabled === true,
    neutral: Object.keys(entry.emotions).length === 0,
    matchedEmotion: null,
    matchedLevel: null,
    loopType,
    loopCount,
    durationSec,
    timeScale,
    effectiveDurationSec,
  } satisfies Omit<
    ManifestIdleCandidateDebug,
    "eligible" | "weight" | "exclusionReason"
  >;

  if (entry.disabled === true) {
    return { ...base, eligible: false, weight: 0, exclusionReason: "disabled" };
  }
  if (
    entry.type !== "vrma" &&
    !(entry.type === "animaPoseClip" && entry.idle_playback)
  ) {
    return { ...base, eligible: false, weight: 0, exclusionReason: "nonVrma" };
  }
  if (!entry.name || !entry.file) {
    return {
      ...base,
      eligible: false,
      weight: 0,
      exclusionReason: "missingNameOrFile",
    };
  }
  if (effectiveDurationSec === null) {
    return {
      ...base,
      eligible: false,
      weight: 0,
      exclusionReason: "nonFiniteDuration",
    };
  }

  if (base.neutral) {
    const weight = normalizePositiveWeight(entry.weight, 1);
    return weight > 0
      ? { ...base, eligible: true, weight, exclusionReason: null }
      : {
          ...base,
          eligible: false,
          weight: 0,
          exclusionReason: "nonPositiveWeight",
        };
  }

  let best: {
    emotion: TrackedEmotion;
    level: EmotionIntensity;
    weight: number;
  } | null = null;
  for (const emotion of TRACKED_EMOTIONS) {
    const weights = entry.emotions[emotion];
    if (!weights) continue;
    const value = emotionalState.values[emotion] ?? 0;
    const level = intensityFromEmotionValue(value);
    if (level === 0) continue;
    const weight = weights[level.toString() as ManifestIntensityKey] ?? 0;
    if (weight > 0 && (!best || weight > best.weight)) {
      best = { emotion, level, weight };
    }
  }

  if (!best) {
    return {
      ...base,
      eligible: false,
      weight: 0,
      exclusionReason: "noActiveEmotionMatch",
    };
  }

  return {
    ...base,
    eligible: true,
    matchedEmotion: best.emotion,
    matchedLevel: best.level,
    weight: best.weight,
    exclusionReason: null,
  };
}

function parseManifestEmotionMap(
  value: unknown,
): Partial<Record<TrackedEmotion, ManifestEmotionWeights>> {
  if (!isRecord(value)) return {};
  const emotions: Partial<Record<TrackedEmotion, ManifestEmotionWeights>> = {};
  for (const [emotion, rawWeights] of Object.entries(value)) {
    if (!isTrackedEmotion(emotion) || !isRecord(rawWeights)) continue;
    const weights: ManifestEmotionWeights = {
      "1": toOptionalNumber(rawWeights["1"]) ?? 0,
      "2": toOptionalNumber(rawWeights["2"]) ?? 0,
      "3": toOptionalNumber(rawWeights["3"]) ?? 0,
    };
    emotions[emotion] = weights;
  }
  return emotions;
}

function normalizePositiveWeight(value: unknown, fallback: number): number {
  const parsed = toOptionalNumber(value) ?? fallback;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function normalizeLoopCount(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function toOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = toOptionalNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  const parsed = toOptionalNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sanitizeRandomRoll(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ensureVrmaExtension(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return trimmed;
  if (trimmed.endsWith(".vrma")) return trimmed;
  return `${trimmed}.vrma`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
