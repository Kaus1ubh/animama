import twemoji from "twemoji";

import type {
  SceneBackgroundEmojiLineItem,
  SceneBackgroundEmojiProvider,
} from "./types";

export const SCENE_BACKGROUND_TWEMOJI_VERSION = "14.0.2";
export const SCENE_BACKGROUND_TWEMOJI_BASE_PATH =
  "/effects/resources/scene-vfx/twemoji";

export function normalizeSceneBackgroundEmojiProvider(
  provider?: SceneBackgroundEmojiProvider,
): SceneBackgroundEmojiProvider {
  return provider ?? "twemoji";
}

export function getSceneBackgroundEmojiCodePoint(emoji: string): string | null {
  const trimmedEmoji = emoji.trim();
  if (!trimmedEmoji) {
    return null;
  }

  const codePoint = twemoji.convert.toCodePoint(trimmedEmoji);
  return codePoint ? codePoint.toLowerCase() : null;
}
export function resolveLocalTwemojiAssetSrc(codePoint: string): string {
  return `${SCENE_BACKGROUND_TWEMOJI_BASE_PATH}/${codePoint}.svg`;
}

export function resolveSceneBackgroundEmojiAssetSrc(
  item: Pick<SceneBackgroundEmojiLineItem, "emoji" | "provider">,
): string | null {
  const provider = normalizeSceneBackgroundEmojiProvider(item.provider);
  if (provider !== "twemoji") {
    return null;
  }

  const codePoint = getSceneBackgroundEmojiCodePoint(item.emoji);
  return codePoint ? resolveLocalTwemojiAssetSrc(codePoint) : null;
}
