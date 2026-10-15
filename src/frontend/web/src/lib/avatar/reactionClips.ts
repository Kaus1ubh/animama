import { AVATAR_REACTION_POOLS } from "./poses/catalog";
import { isTrackedEmotion, type TrackedEmotion } from "@/lib/emotion";
import type { EmotionReactionIntensity } from "./reactionPools";

/** A chat event's Reaction intensity; 0 plays no Reaction. */
export type NormalizedEmotionReactionIntensity = 0 | EmotionReactionIntensity;
export type EmotionReactionTone = TrackedEmotion;

/** Read `emotion.update`'s Reaction intensity (0–4), clamping larger values to 4. */
export function normalizeEmotionReactionIntensity(
  value: unknown,
): NormalizedEmotionReactionIntensity {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(4, Math.round(value))) as
    | 0
    | EmotionReactionIntensity;
}

export function resolveEmotionReactionTone(
  value: string | null | undefined,
): EmotionReactionTone | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized === "neutral") return null;
  return isTrackedEmotion(normalized) ? normalized : null;
}

/**
 * The built-in pool of an emotion event's cell: its Included Reactions, as a
 * new Anima's starter pool holds them (Mild has `<emotion>-1`; Moderate to
 * Intense have `<emotion>-<intensity>` and `<emotion>-<intensity>-b`). A
 * neutral or unknown tone, or intensity 0, has no cell and an empty pool.
 */
export function getIncludedReactionPool(args: {
  emotionalTone: string | null | undefined;
  emotionalIntensity: NormalizedEmotionReactionIntensity;
}): readonly string[] {
  if (args.emotionalIntensity === 0) return [];
  const tone = resolveEmotionReactionTone(args.emotionalTone);
  if (!tone) return [];
  return AVATAR_REACTION_POOLS[tone]?.[String(args.emotionalIntensity)] ?? [];
}
