import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import {
  contentCreatorModelPreviewTarget,
  type ContentCreatorModelSource,
} from "@/ui/content-creator/contentCreatorModelPreview";

/** Pose Creator compatibility names backed by the shared Content Creator model seam. */
export {
  contentCreatorModelSourceFromAnima as poseCreatorModelSourceFromAnima,
  selectContentCreatorPreviewAnima as selectPoseCreatorPreviewAnima,
  shouldPersistLastActiveAnima,
} from "@/ui/content-creator/contentCreatorModelPreview";
export type {
  ContentCreatorModelSource as PoseCreatorModelSource,
  ContentCreatorPreviewAnimaStatus as PoseCreatorPreviewAnimaStatus,
} from "@/ui/content-creator/contentCreatorModelPreview";

export function poseCreatorModelPreviewTarget(input: {
  source: ContentCreatorModelSource | null;
  animaId: string | null;
  runtime: AnimaRuntimeCatalogSnapshot | null;
}): ContentPreviewTarget | null {
  return contentCreatorModelPreviewTarget({
    ...input,
    ownerKey: "pose-creator",
  });
}
