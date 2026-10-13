"use client";

import { getI18n } from "react-i18next";

/**
 * Ask before replacing unsaved Pose edits. `message` defaults to the
 * replace-the-draft question in the UI Locale.
 */
export function confirmPoseCreatorDirtyReplacement(
  isDirty: boolean,
  message?: string,
): boolean {
  if (!isDirty) return true;
  const t = getI18n().getFixedT(null, "pose");
  return window.confirm(message ?? t("dirty.replace"));
}
