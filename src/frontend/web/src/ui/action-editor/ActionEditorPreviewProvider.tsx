"use client";

/**
 * Typed action name for the preserved preview-model provider. The
 * implementation remains shared with pose-clip authoring while product UI no
 * longer depends on the retired generic Pose Creator route.
 */
export {
  PoseCreatorPreviewProvider as ActionEditorPreviewProvider,
  usePoseCreatorPreview as useActionEditorPreview,
} from "@/ui/pose-creator/PoseCreatorPreviewProvider";
