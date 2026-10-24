import type { PyTypedContentFile } from "@animama/runtime-contracts/api-types";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
]);

/** Keep tint lookup tied to the same registered texture as the thumbnail. */
export function particleThumbnailSource(
  files: readonly PyTypedContentFile[],
  revision: string,
) {
  const ordered = [...files].sort((a, b) => a.ordinal - b.ordinal);
  const texture = ordered.find((file) => IMAGE_TYPES.has(file.media_type));
  const manifest = ordered.find((file) => file.role === "manifest");
  return texture && manifest
    ? {
        manifestUrl: `/v1/content/files/${encodeURIComponent(manifest.file_ref)}`,
        texturePath: texture.logical_path,
        revision,
      }
    : undefined;
}

/**
 * Use the first registered image, never an arbitrary URL from effect JSON. The
 * thumbnail variant is a small WebP of that image, so a Library tile never
 * downloads full-size art or a whole flipbook sheet.
 */
export function contentThumbnailUrl(
  files: readonly PyTypedContentFile[],
): string | null {
  const image = files
    .filter((file) => IMAGE_TYPES.has(file.media_type))
    .sort((left, right) => left.ordinal - right.ordinal)[0];
  return image
    ? `/v1/content/files/${encodeURIComponent(image.file_ref)}?variant=thumbnail`
    : null;
}
