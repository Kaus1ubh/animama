import type { KeyboardEvent } from "react";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { isPoseCreatorNativeUndoTarget } from "./poseCreatorUndo";

/** Delete the focused timeline's selection using its normal undoable mutations. */
export function handleTimelineDeleteKey(event: KeyboardEvent<HTMLElement>) {
  if (
    (event.key !== "Delete" && event.key !== "Backspace") ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    isPoseCreatorNativeUndoTarget(event.target)
  )
    return;

  const state = usePoseCreatorStore.getState();
  const { selectedEventId, selectedKeyframeId } = state.clipDraft;
  if (!selectedEventId && !selectedKeyframeId) return;
  // Inline pose editing owns a separate history until Apply or Cancel.
  if (state.clipInlineEdit) return;

  event.preventDefault();
  event.stopPropagation();
  if (selectedEventId) state.deleteSelectedClipEvent();
  else state.deleteSelectedClipKeyframe();
  // The deleted marker loses focus; keep subsequent keyboard actions here.
  event.currentTarget.focus({ preventScroll: true });
}
