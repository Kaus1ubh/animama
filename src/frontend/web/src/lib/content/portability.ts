/**
 * Non-portable Included content plays and previews normally but never leaves
 * the app as files: no customizing, copying or exporting. The backend decides
 * and enforces this; the UI only explains unavailable actions.
 */

import { getI18n } from "react-i18next";

/** Plain-language reason shown wherever an action is unavailable, in the UI Locale. */
export function nonPortableReason(): string {
  const t = getI18n().getFixedT(null, "library");
  return t("content.nonPortableReason");
}

/** Whether a catalog item is non-portable; a missing value means portable. */
export function isNonPortable(
  item: { portability?: string | null } | null | undefined,
): boolean {
  return item?.portability === "non-portable";
}
