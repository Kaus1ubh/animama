import type { PyIdleStylePreview } from "@/lib/content/catalogTypes";
import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Materialize the preview-selected idle animation without changing a loadout. */
export function idleStylePreviewTarget(
  preview: PyIdleStylePreview,
  label: string,
  animaId?: string,
  animaRuntime?: AnimaRuntimeCatalogSnapshot,
): ContentPreviewTarget {
  const style = Object.keys(object(preview.metadata.style)).length
    ? object(preview.metadata.style)
    : object(preview.metadata);
  const animations = Array.isArray(style.animations) ? style.animations : [];
  const animation = object(
    animations.find(
      (row) => object(row).animation_id === preview.selected_animation_id,
    ),
  );
  const runtimeId = String(animation.animation_id ?? "idle-preview");
  const config = {
    ...object(animation.playback),
    preload_tier: "tier_a",
  };
  const ordinal = Number(animation.ordinal);
  const filename = String(animation.file ?? "")
    .split("/")
    .at(-1);
  const file = preview.files.find(
    (candidate) =>
      candidate.role === "animation" &&
      (candidate.filename === filename || candidate.ordinal === ordinal),
  );
  if (!file) throw new Error("The preview animation file is unavailable.");
  const entry: RuntimeCatalogEntry = {
    slot: "idle_animation",
    runtime_id: runtimeId,
    kind: "animation",
    display_name: String(animation.name ?? label),
    description: String(animation.description ?? label),
    config_schema_version: 1,
    config,
    content_revision: `idle-preview:${preview.revision}:${file.sha256}`,
    source: {
      type: "authorized_files",
      files: [
        {
          role: file.role,
          ordinal: file.ordinal,
          filename: file.filename,
          content_type: file.media_type,
          size_bytes: file.size_bytes,
          content_revision: file.sha256,
          url: file.url,
        },
      ],
      logical_resource_urls: {},
    },
  };
  return {
    key: `idle-style-preview:${preview.preview_id}:${runtimeId}`,
    sourceType: "resolved_entry",
    entry,
    kind: "animation",
    displayName: String(animation.name ?? label),
    versionLabel: "Exact saved Idle Style",
    slot: "idle_animation",
    runtimeId,
    configSchemaVersion: 1,
    config,
    ...(animaId && animaRuntime
      ? { animaContext: { animaId, runtime: animaRuntime } }
      : {}),
  };
}
