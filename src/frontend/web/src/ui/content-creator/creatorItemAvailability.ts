import { getI18n } from "react-i18next";

import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";

type CreatorItem = Pick<PyCatalogViewItem, "state" | "origin" | "editable">;

/** Included items are immutable but open as a Local copy; owned items must be editable. */
export function isCreatorItemOpenable(item: CreatorItem): boolean {
  return item.state === "ready" && (item.origin !== "owned" || !!item.editable);
}

/**
 * Decide whether a creator edit route can open its saved item.
 *
 * Returns the message for the creator's unavailable state, or `null` while the
 * item is new, still loading or openable. A failed read only counts when no
 * item is cached, so a background refetch error never replaces an open document.
 */
export function creatorItemUnavailableMessage({
  itemId,
  label,
  item,
  readFailed,
  loadError,
}: {
  itemId: string | null | undefined;
  /** Singular content name shown to the user, such as "Avatar Effect". */
  label: string;
  item: CreatorItem | undefined;
  readFailed: boolean;
  /** Failure while downloading or parsing the item's content files. */
  loadError?: string | null;
}): string | null {
  if (!itemId) return null;
  if (loadError) return loadError;
  const t = getI18n().getFixedT(null, "creator");
  if (!item) return readFailed ? t("unavailable.notFound", { label }) : null;
  if (!isCreatorItemOpenable(item))
    return t("unavailable.unavailable", { label });
  return null;
}
