import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";

export type AnimaAvatarPortraitEligibility = {
  animaId?: string | null;
  runtimeContent?: AnimaRuntimeCatalogSnapshot | null;
  avatarEntry?: RuntimeCatalogEntry | null;
  avatarReady: boolean;
  temporaryPreviewModel: boolean;
};

/**
 * Generate only from an already-visible owner model that would be the Anima's
 * actual fallback. This deliberately excludes App models and hidden bulk work.
 */
export function shouldGenerateAnimaAvatarPortrait({
  animaId,
  runtimeContent,
  avatarEntry,
  avatarReady,
  temporaryPreviewModel,
}: AnimaAvatarPortraitEligibility): boolean {
  return Boolean(
    animaId &&
    avatarReady &&
    !temporaryPreviewModel &&
    runtimeContent &&
    !runtimeContent.profile_image &&
    avatarEntry?.source.type === "authorized_files",
  );
}
