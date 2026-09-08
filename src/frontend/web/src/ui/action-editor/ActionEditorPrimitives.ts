/**
 * Typed-editor ownership boundary for the preserved immersive authoring UI.
 * Implementations still share schema-level pose-clip mechanics internally;
 * product routes import them only through this typed action module.
 */
export { PoseCreatorAvatarActor as ActionEditorAvatarActor } from "@/ui/pose-creator/PoseCreatorAvatarActor";
export { PoseCreatorBoneSection as ActionEditorBoneSection } from "@/ui/pose-creator/PoseCreatorBoneSection";
export { PoseCreatorClipPreviewSync as ActionEditorClipPreviewSync } from "@/ui/pose-creator/PoseCreatorClipPreviewSync";
export { PoseCreatorClipWorkspaceInspector as ActionEditorClipInspector } from "@/ui/pose-creator/PoseCreatorClipWorkspaceInspector";
export { PoseCreatorExpressionSection as ActionEditorExpressionSection } from "@/ui/pose-creator/PoseCreatorExpressionSection";
export { PoseCreatorPreviewSettingsPanel as ActionEditorPreviewSettings } from "@/ui/pose-creator/PoseCreatorPreviewSettingsPanel";
export {
  buildPoseCreatorBakedAnimaPose as buildActionEditorPose,
  replacePoseCreatorDraftWithAnimaPose as replaceActionEditorPose,
} from "@/ui/pose-creator/poseCreatorAuthoring";
