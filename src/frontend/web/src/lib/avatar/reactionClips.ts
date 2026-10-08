import { getAvatarReactionClip, hasAvatarReactionClip } from "./poses/catalog";
import type { AnimaPoseClipV2 } from "./poses/animaPoseClip";
import { isTrackedEmotion, type TrackedEmotion } from "@/lib/emotion";

export type EmotionReactionIntensity = 1 | 2 | 3;
export type NormalizedEmotionReactionIntensity = 0 | EmotionReactionIntensity;
export type EmotionReactionTone = TrackedEmotion;

export type EmotionReactionClipSelection = {
  tone: EmotionReactionTone;
  intensity: EmotionReactionIntensity;
  clipId: string;
  clip: AnimaPoseClipV2;
};

export function normalizeEmotionReactionIntensity(
  value: unknown,
): NormalizedEmotionReactionIntensity {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.round(value))) as
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

export function getEmotionReactionClipId(args: {
  emotionalTone: string | null | undefined;
  emotionalIntensity: NormalizedEmotionReactionIntensity;
}): string | null {
  if (args.emotionalIntensity === 0) return null;

  const tone = resolveEmotionReactionTone(args.emotionalTone);
  if (!tone) return null;
  return `${tone}-${args.emotionalIntensity}`;
}

export function selectEmotionReactionClip(args: {
  emotionalTone: string | null | undefined;
  emotionalIntensity: NormalizedEmotionReactionIntensity;
}): EmotionReactionClipSelection | null {
  if (args.emotionalIntensity === 0) return null;

  const tone = resolveEmotionReactionTone(args.emotionalTone);
  if (!tone) return null;

  const clipId = `${tone}-${args.emotionalIntensity}`;
  if (!hasAvatarReactionClip(clipId)) return null;

  return {
    tone,
    intensity: args.emotionalIntensity,
    clipId,
    clip: getAvatarReactionClip(clipId),
  };
}
