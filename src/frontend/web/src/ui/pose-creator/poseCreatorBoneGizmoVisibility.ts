import type { PoseCreatorAuthoringMode } from "./poseCreatorClipAuthoring";

type PoseCreatorBoneGizmoVisibilityInput = {
  boneHelperNodesVisible: boolean;
  authoringMode: PoseCreatorAuthoringMode;
  hasClipInlineEdit: boolean;
  clipPlaybackPlaying: boolean;
};

/** The helper toggle owns both markers and rotation controls; Clip editing must also be paused. */
export function shouldShowPoseCreatorBoneGizmo({
  boneHelperNodesVisible,
  authoringMode,
  hasClipInlineEdit,
  clipPlaybackPlaying,
}: PoseCreatorBoneGizmoVisibilityInput): boolean {
  if (!boneHelperNodesVisible) return false;
  if (authoringMode === "pose") return true;
  return hasClipInlineEdit && !clipPlaybackPlaying;
}
