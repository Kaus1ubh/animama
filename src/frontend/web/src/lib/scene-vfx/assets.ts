import type { SceneBackgroundLineItem } from "./types";

/**
 * Copy a line item. PNG and SVG items name their URL, so the copy serves as
 * an editable draft and is drawn as it is.
 */
export function cloneSceneBackgroundLineItem<
  TItem extends SceneBackgroundLineItem,
>(item: TItem): TItem {
  return {
    ...item,
  };
}
