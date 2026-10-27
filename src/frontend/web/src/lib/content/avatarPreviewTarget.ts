import type { PyContentPreview } from "@/lib/content/catalogTypes";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { contentPreviewFileUrl } from "./contentPreview";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Adapt an exact Avatar preview to the shared single-Canvas preview dock. */
export function avatarPreviewTarget(
  preview: PyContentPreview,
  displayName: string,
): ContentPreviewTarget {
  const metadata = object(preview.metadata);
  const files = preview.files.map((file) => ({
    role: file.role === "vrm" ? "model" : file.role,
    ordinal: file.ordinal,
    filename: file.filename,
    content_type: file.media_type,
    size_bytes: file.size_bytes,
    // The VRM digest lets the preview Avatar apply a saved face part correction.
    sha256: file.sha256,
    content_revision: file.sha256,
    url: contentPreviewFileUrl(preview, file),
  }));
  const entry: RuntimeCatalogEntry = {
    slot: "primary_model",
    runtime_id: `preview-avatar-${preview.preview_id}`,
    kind: "avatar_model",
    display_name: displayName,
    description: displayName,
    config_schema_version: 1,
    config: {
      ...object(object(metadata.spec).presentation),
      // The Avatar item, so the preview loads with its saved settings.
      ...(preview.item_id ? { avatar_catalog_item_id: preview.item_id } : {}),
      // Its saved face part correction, as the Anima runtime entry carries it.
      ...(metadata.face_parts ? { face_parts: metadata.face_parts } : {}),
    },
    content_revision: preview.revision,
    source: { type: "authorized_files", files },
  };
  return {
    key: `typed-avatar:${preview.preview_id}:${preview.revision}`,
    sourceType: "resolved_entry",
    entry,
    kind: "avatar_model",
    displayName,
    versionLabel: preview.revision,
    slot: "primary_model",
    runtimeId: entry.runtime_id,
    configSchemaVersion: 1,
    config: entry.config,
  };
}
