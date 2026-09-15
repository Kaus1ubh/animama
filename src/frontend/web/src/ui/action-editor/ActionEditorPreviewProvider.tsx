"use client";

/**
 * Typed action exports for the preview-model provider shared with pose-clip
 * authoring. Action editors use these names without depending on a route.
 */
export {
  PoseCreatorPreviewProvider as ActionEditorPreviewProvider,
  usePoseCreatorPreview as useActionEditorPreview,
} from "@/ui/pose-creator/PoseCreatorPreviewProvider";
