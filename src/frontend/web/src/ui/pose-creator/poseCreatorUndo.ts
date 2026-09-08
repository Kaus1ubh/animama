import { usePoseCreatorStore } from "@/stores/pose-creator-store";

export type PoseCreatorDraftUndoGroup = "pose" | "clip";
export type PoseCreatorHistoryKeyboardAction = "undo" | "redo";
export type PoseCreatorHistoryShortcutLabels = {
  undo: string;
  redo: string;
};

function readBrowserPlatformHint(): string {
  if (typeof navigator === "undefined") return "";
  return `${navigator.platform} ${navigator.userAgent}`;
}

/** Format history shortcuts using the host OS conventions shown to the user. */
export function getPoseCreatorHistoryShortcutLabels(
  os: string | null = null,
  browserPlatformHint = readBrowserPlatformHint(),
): PoseCreatorHistoryShortcutLabels {
  const platform = `${os ?? ""} ${browserPlatformHint}`.toLowerCase();
  const isApplePlatform = /darwin|mac|iphone|ipad|ipod/.test(platform);
  return isApplePlatform
    ? { undo: "⌘Z", redo: "⇧⌘Z" }
    : { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z or Ctrl+Y" };
}

/** Route FK/expression edits to Pose history or the active inline Clip pose. */
export function beginPoseCreatorDraftUndoGroup(): PoseCreatorDraftUndoGroup {
  const state = usePoseCreatorStore.getState();
  if (state.clipInlineEdit) {
    state.beginClipUndoGroup();
    return "clip";
  }
  state.beginPoseUndoGroup();
  return "pose";
}

export function endPoseCreatorDraftUndoGroup(
  group: PoseCreatorDraftUndoGroup,
): void {
  const state = usePoseCreatorStore.getState();
  if (group === "clip") state.endClipUndoGroup();
  else state.endPoseUndoGroup();
}

export function isPoseCreatorUndoKeyboardEvent(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): boolean {
  return (
    event.key.toLowerCase() === "z" &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey)
  );
}

export function getPoseCreatorHistoryKeyboardAction(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): PoseCreatorHistoryKeyboardAction | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z" && (event.metaKey || event.ctrlKey)) {
    return event.shiftKey ? "redo" : "undo";
  }
  if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return "redo";
  }
  return null;
}

/** Preserve the browser's native text-editing undo while fields are focused. */
export function isPoseCreatorNativeUndoTarget(
  target: EventTarget | null,
): boolean {
  const candidate = target as
    | (EventTarget & { closest?: Element["closest"] })
    | null;
  if (typeof candidate?.closest !== "function") {
    return false;
  }
  return Boolean(
    candidate.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ),
  );
}
