import type { PyContentPreview } from "@/lib/content/catalogTypes";
import type {
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import { contentPreviewFileUrl } from "./contentPreview";
import { findLogicalResourceFile } from "./typedLogicalResources";

type VisualComponentType = "particle_effect" | "avatar_effect" | "scene_effect";

type VisualPreviewKind = Extract<
  ContentPreviewTarget["kind"],
  "particle_vfx" | "avatar_vfx" | "scene_vfx"
>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Prefer a projected runtime ID and otherwise use the logical-key leaf. */
function componentRuntimeId(
  metadata: Record<string, unknown>,
  preview: PyContentPreview,
): string {
  const projected = metadata.runtime_id;
  if (typeof projected === "string" && projected.trim()) {
    return projected.trim();
  }
  const contentId = String(
    metadata.content_id ?? metadata.item_id ?? preview.item_id ?? "",
  ).trim();
  const leaf = contentId.split(":").at(-1)?.trim();
  return leaf || `preview-${preview.preview_id}`;
}

function presentation(
  contentType: VisualComponentType,
  contentId: string,
  definition: Record<string, unknown> = {},
) {
  if (contentType === "particle_effect")
    return {
      kind: "particle_vfx" as VisualPreviewKind,
      slot: "particle_vfx" as const,
    };
  if (contentType === "avatar_effect")
    return {
      kind: "avatar_vfx" as VisualPreviewKind,
      slot: "avatar_vfx" as const,
    };
  return {
    kind: "scene_vfx" as VisualPreviewKind,
    slot: (definition.kind === "focus_lines" || contentId.includes(":focus:")
      ? "scene_focus_vfx"
      : "scene_background_vfx") as RuntimeContentSlot,
  };
}

function privateEntry(
  preview: PyContentPreview,
  contentType: VisualComponentType,
  displayName: string,
): RuntimeCatalogEntry {
  const metadata = object(preview.metadata);
  const spec = object(metadata.spec);
  const contentId = String(metadata.item_id ?? preview.preview_id);
  const runtimeId = componentRuntimeId(metadata, preview);
  const definition = object(metadata.definition ?? spec.definition);
  const { kind, slot } = presentation(contentType, contentId, definition);
  const runtimeSlots = object(object(metadata.runtime_defaults).slots);
  const runtimeSlot =
    contentType === "particle_effect"
      ? "particle_vfx"
      : contentType === "avatar_effect"
        ? "avatar_vfx"
        : "scene_vfx";
  const supportFileRefs = new Set(
    (Array.isArray(metadata.supports) ? metadata.supports : []).flatMap(
      (rawSupport) => {
        const support = object(rawSupport);
        return (Array.isArray(support.files) ? support.files : []).flatMap(
          (rawFile) => {
            const file = object(rawFile);
            return typeof file.file_ref === "string" ? [file.file_ref] : [];
          },
        );
      },
    ),
  );
  const files = preview.files
    .filter(
      (file) =>
        !supportFileRefs.has(file.file_ref) &&
        file.role !== "descriptor" &&
        file.role !== "metadata",
    )
    .map((file) => ({
      file_ref: file.file_ref,
      role: file.role,
      ordinal: file.ordinal,
      filename: file.filename,
      content_type: file.media_type,
      size_bytes: file.size_bytes,
      content_revision: file.sha256,
      url: contentPreviewFileUrl(preview, file),
    }));
  const logicalFiles = object(metadata.logical_resource_files);
  const logicalResourceUrls = Object.fromEntries(
    Object.entries(logicalFiles).flatMap(([logicalName, rawIdentity]) => {
      const identity = object(rawIdentity);
      const file = findLogicalResourceFile(files, identity);
      return file ? [[logicalName, file.url]] : [];
    }),
  );
  return {
    slot,
    runtime_id: runtimeId,
    kind,
    display_name: displayName,
    description: displayName,
    config_schema_version: 1,
    config: {
      ...object(spec.defaults),
      ...object(metadata.config),
      ...object(runtimeSlots[runtimeSlot]),
      runtime_reference_map: object(metadata.reference_map),
    },
    definition,
    content_revision: preview.revision,
    source: {
      type: "authorized_files",
      files,
      logical_resource_urls: logicalResourceUrls,
    },
  };
}

function previewSupportEntries(
  preview: PyContentPreview,
): RuntimeCatalogEntry[] {
  const metadata = object(preview.metadata);
  return (Array.isArray(metadata.supports) ? metadata.supports : []).flatMap(
    (rawSupport) => {
      const support = object(rawSupport);
      if (support.content_type !== "sound_effect") return [];
      const runtimeId = String(support.runtime_id ?? "");
      if (!runtimeId) return [];
      const sourceFiles = Array.isArray(support.files) ? support.files : [];
      const files = sourceFiles.flatMap((rawFile) => {
        const identity = object(rawFile);
        const file = preview.files.find(
          (candidate) =>
            candidate.file_ref === identity.file_ref ||
            (candidate.role === identity.role &&
              candidate.ordinal === Number(identity.ordinal)),
        );
        return file
          ? [
              {
                file_ref: file.file_ref,
                role: file.role,
                ordinal: file.ordinal,
                filename: file.filename,
                content_type: file.media_type,
                size_bytes: file.size_bytes,
                content_revision: file.sha256,
                url: contentPreviewFileUrl(preview, file),
              },
            ]
          : [];
      });
      return [
        {
          slot: "sfx" as const,
          runtime_id: runtimeId,
          kind: "audio" as const,
          display_name: String(support.name ?? runtimeId),
          description: null,
          config_schema_version: 1,
          config: object(support.config),
          content_revision: `${preview.revision}:${runtimeId}`,
          source: { type: "authorized_files", files } as const,
        },
      ];
    },
  );
}

/** Adapt a typed visual component preview to the existing single Canvas dock. */
export function componentPreviewTarget(
  preview: PyContentPreview,
  contentType: VisualComponentType,
  displayName: string,
): ContentPreviewTarget {
  const metadata = object(preview.metadata);
  const contentId = String(metadata.content_id ?? preview.preview_id);
  const { kind, slot } = presentation(
    contentType,
    contentId,
    object(metadata.definition ?? object(metadata.spec).definition),
  );
  const entry = privateEntry(preview, contentType, displayName);
  return {
    key: `typed-component:${preview.preview_id}:${preview.revision}`,
    sourceType: "resolved_entry",
    entry,
    kind,
    displayName,
    versionLabel: preview.revision,
    slot,
    runtimeId: entry.runtime_id,
    configSchemaVersion: entry.config_schema_version,
    config: entry.config,
    supportEntries: previewSupportEntries(preview),
  };
}
