import { toast } from "sonner";

import type { ActionEditorMode } from "./actionEditorCapabilities";

import {
  isPoseCreatorBasePose,
  usePoseCreatorStore,
  type PoseCreatorSavedDraft,
} from "@/stores/pose-creator-store";
import { replacePoseCreatorDraftWithAnimaPose } from "@/ui/pose-creator/poseCreatorAuthoring";
import { confirmPoseCreatorDirtyReplacement } from "@/ui/pose-creator/poseCreatorDirtyGuard";

/** Load a saved Pose independently of the clip, retaining its identity for Save. */
export function editActionEditorSavedPose(
  draft: PoseCreatorSavedDraft,
): boolean {
  const state = usePoseCreatorStore.getState();
  if (!state.activeAvatar) {
    toast.error("Load an Avatar Model before editing a saved pose.");
    return false;
  }
  if (
    !confirmPoseCreatorDirtyReplacement(
      state.isDirty || Boolean(state.clipInlineEdit?.isDirty),
    )
  )
    return false;

  const basePose = isPoseCreatorBasePose(draft.basePose)
    ? draft.basePose
    : state.basePose;
  try {
    const replacement = replacePoseCreatorDraftWithAnimaPose(
      state.activeAvatar,
      draft.pose,
      basePose,
    );
    state.cancelClipInlinePoseEdit();
    if (!state.loadSavedDraft(draft.id, { basePose, ...replacement })) {
      return false;
    }
    // Standalone Pose editing suspends clip playback and enables live bone edits.
    state.setAuthoringMode("pose");
    return true;
  } catch {
    toast.error("Could not load the saved pose into this avatar.");
    return false;
  }
}

/** Resume a standalone Pose after previewing the clip without replacing its draft. */
export function setActionEditorAuthoringMode(mode: ActionEditorMode): void {
  const state = usePoseCreatorStore.getState();
  const resumePose =
    mode === "pose" &&
    !state.clipInlineEdit &&
    (state.selectedSavedDraftId !== null || state.isDirty);
  state.setAuthoringMode(resumePose ? "pose" : "clip");
}
