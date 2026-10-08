/**
 * Non-portable Included content plays and previews normally but never leaves
 * the app as files: no customizing, copying or exporting. The backend decides
 * and enforces this; the UI only explains unavailable actions.
 */

/** Plain-language reason shown wherever an action is unavailable. */
export const NON_PORTABLE_REASON =
  "Included with this app for use here only. It can't be customized, copied or exported.";

/** Whether a catalog item is non-portable; a missing value means portable. */
export function isNonPortable(
  item: { portability?: string | null } | null | undefined,
): boolean {
  return item?.portability === "non-portable";
}
