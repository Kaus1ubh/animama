"use client";

export function confirmPoseCreatorDirtyReplacement(
  isDirty: boolean,
  message = "Discard unsaved pose changes and replace the current draft?",
): boolean {
  if (!isDirty) return true;
  return window.confirm(message);
}
