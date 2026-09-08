import type { PoseCreatorAuthoringMode } from "./poseCreatorClipAuthoring";

type PoseCreatorBoneGizmoVisibilityInput = {
  authoringMode: PoseCreatorAuthoringMode;
  hasClipInlineEdit: boolean;
  clipPlaybackPlaying: boolean;
};

/** Keeps direct bone manipulation out of normal Clip preview and playback. */
export function shouldShowPoseCreatorBoneGizmo({
  authoringMode,
  hasClipInlineEdit,
  clipPlaybackPlaying,
}: PoseCreatorBoneGizmoVisibilityInput): boolean {
  if (authoringMode === "pose") return true;
  return hasClipInlineEdit && !clipPlaybackPlaying;
}
