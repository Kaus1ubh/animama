import {
  normalizeSceneBackgroundEmojiProvider,
  resolveSceneBackgroundEmojiAssetSrc,
} from "./emoji";
import {
  getSceneBackgroundEmojiLineItems,
  getSceneBackgroundLineItemById as getCatalogSceneBackgroundLineItemById,
  getSceneBackgroundLineItems,
  getSceneBackgroundPngLineItems,
  getSceneBackgroundSvgLineItems,
} from "./catalog";
import type {
  ResolvedSceneBackgroundLineItem,
  SceneBackgroundEmojiLineItem,
  SceneBackgroundLineItem,
  SceneBackgroundPngLineItem,
  SceneBackgroundSvgLineItem,
} from "./types";

export const SCENE_BACKGROUND_PNG_LINE_ITEMS: SceneBackgroundPngLineItem[] =
  getSceneBackgroundPngLineItems();

export const SCENE_BACKGROUND_EMOJI_LINE_ITEMS: SceneBackgroundEmojiLineItem[] =
  getSceneBackgroundEmojiLineItems();

export const SCENE_BACKGROUND_SVG_LINE_ITEMS: SceneBackgroundSvgLineItem[] =
  getSceneBackgroundSvgLineItems();

export const SCENE_BACKGROUND_LINE_ITEMS: SceneBackgroundLineItem[] =
  getSceneBackgroundLineItems();

export function cloneSceneBackgroundLineItem<
  TItem extends SceneBackgroundLineItem,
>(item: TItem): TItem {
  return {
    ...item,
  };
}

export function cloneResolvedSceneBackgroundLineItem<
  TItem extends ResolvedSceneBackgroundLineItem,
>(item: TItem): TItem {
  return {
    ...item,
  };
}

export function toSceneBackgroundLineItemDraft(
  item: SceneBackgroundLineItem | ResolvedSceneBackgroundLineItem,
): SceneBackgroundLineItem {
  if (item.kind === "png" || item.kind === "svg") {
    return cloneSceneBackgroundLineItem(item);
  }

  return {
    id: item.id,
    kind: "emoji",
    emoji: item.emoji,
    label: item.label,
    provider: normalizeSceneBackgroundEmojiProvider(item.provider),
  };
}

export function resolveSceneBackgroundLineItem(
  item: SceneBackgroundLineItem,
): ResolvedSceneBackgroundLineItem | null {
  if (item.kind === "png" || item.kind === "svg") {
    return cloneResolvedSceneBackgroundLineItem(item);
  }

  const src = resolveSceneBackgroundEmojiAssetSrc(item);
  if (!src) {
    return null;
  }

  return {
    ...item,
    provider: normalizeSceneBackgroundEmojiProvider(item.provider),
    src,
  };
}

export function getSceneBackgroundLineItemById(
  itemId: string,
): SceneBackgroundLineItem | null {
  return getCatalogSceneBackgroundLineItemById(itemId);
}
