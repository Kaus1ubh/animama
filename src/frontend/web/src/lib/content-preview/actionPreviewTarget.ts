import type { PyActionPreview } from "@/lib/content/catalogTypes";
import type {
  RuntimeResourceKind,
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  PyRuntimeFile,
  RuntimeContentSlot,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import { buildLibraryPreviewRuntime } from "@/lib/content-preview/targets";
import { contentPreviewFileUrl } from "@/lib/content/contentPreview";
import { findLogicalResourceFile } from "@/lib/content/typedLogicalResources";
import { WordedError } from "@/lib/errors/apiError";
import { getI18n } from "react-i18next";
import { actionClosure } from "./ActionPreviewSession";

type ClosureNode = Record<string, unknown>;

const slotsByType: Record<string, RuntimeContentSlot> = {
  particle_effect: "particle_vfx",
  avatar_effect: "avatar_vfx",
  sound_effect: "sfx",
};
const kindsByType: Record<string, RuntimeResourceKind> = {
  particle_effect: "particle_vfx",
  avatar_effect: "avatar_vfx",
  scene_effect: "scene_vfx",
  sound_effect: "audio",
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function exactSource(node: ClosureNode): Record<string, unknown> {
  return object(node.source);
}

function logicalKeyLeaf(value: unknown): string {
  const logicalKey = typeof value === "string" ? value.trim() : "";
  return logicalKey.split(":").at(-1)?.trim() ?? "";
}

function previewFiles(
  preview: PyActionPreview,
  node: ClosureNode,
): PyRuntimeFile[] {
  const t = getI18n().getFixedT(null, "actionEditor");
  const inlineDocument = node.inline_document;
  if (inlineDocument && typeof inlineDocument === "object") {
    const encoded = encodeURIComponent(JSON.stringify(inlineDocument));
    return [
      {
        role: "sequence",
        ordinal: 1,
        filename: "draft-sequence.json",
        content_type: "application/json",
        size_bytes: JSON.stringify(inlineDocument).length,
        content_revision: `${preview.revision}:inline`,
        url: `data:application/json;charset=utf-8,${encoded}`,
      },
    ];
  }
  const files = Array.isArray(node.files) ? node.files : [];
  return files.map((raw) => {
    const file = object(raw);
    const fileRef = String(file.file_ref ?? "");
    if (!fileRef) throw new WordedError(t("preview.errors.fileUnauthorized"));
    return {
      file_ref: fileRef,
      role: String(file.role),
      ordinal: Number(file.ordinal),
      filename: String(file.filename),
      content_type: String(file.media_type),
      size_bytes: Number(file.size_bytes),
      content_revision: String(file.sha256),
      url: contentPreviewFileUrl(preview, { file_ref: fileRef }),
    };
  });
}

function privateRuntimeEntry(
  preview: PyActionPreview,
  node: ClosureNode,
  slot: RuntimeContentSlot,
  runtimeId: string,
  kind: RuntimeResourceKind,
): RuntimeCatalogEntry {
  const files = previewFiles(preview, node);
  const logicalFiles = object(node.logical_resource_files);
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
    display_name: String(node.name ?? runtimeId),
    description: String(node.description ?? node.name ?? runtimeId),
    config_schema_version: 1,
    config: {
      ...object(node.config),
      runtime_reference_map: object(node.reference_map),
      // Removed Included effects an Action plays without (alias → ref).
      ...(node.missing_references
        ? { runtime_missing_references: object(node.missing_references) }
        : {}),
    },
    definition: object(node.definition),
    content_revision: `${preview.revision}:${String(
      exactSource(node).catalog_item_id ??
        exactSource(node).content_id ??
        "catalog",
    )}`,
    source: {
      type: "authorized_files",
      files,
      logical_resource_urls: logicalResourceUrls,
    },
  };
}

function nodeEntry(
  preview: PyActionPreview,
  node: ClosureNode,
  slot: RuntimeContentSlot,
  runtimeId: string,
  kind: RuntimeResourceKind,
): RuntimeCatalogEntry {
  return privateRuntimeEntry(preview, node, slot, runtimeId, kind);
}

function supportSlot(node: ClosureNode): RuntimeContentSlot {
  const t = getI18n().getFixedT(null, "actionEditor");
  const contentType = String(node.content_type ?? "");
  if (contentType === "scene_effect") {
    const definitionKind = String(object(node.definition).kind ?? "");
    if (definitionKind === "focus_lines") return "scene_focus_vfx";
    if (definitionKind === "background_layers") return "scene_background_vfx";
    return String(exactSource(node).content_id).includes(":focus:")
      ? "scene_focus_vfx"
      : "scene_background_vfx";
  }
  const slot = slotsByType[contentType];
  if (!slot)
    throw new WordedError(
      t("preview.errors.unsupportedComponent", { type: contentType }),
    );
  return slot;
}

function append(
  runtime: AnimaRuntimeCatalogSnapshot,
  entry: RuntimeCatalogEntry,
) {
  const lanes: Partial<
    Record<RuntimeContentSlot, keyof AnimaRuntimeCatalogSnapshot>
  > = {
    particle_vfx: "particle_vfx",
    avatar_vfx: "avatar_vfx",
    scene_background_vfx: "scene_background_vfx",
    scene_focus_vfx: "scene_focus_vfx",
    sfx: "sfx",
  };
  const lane = lanes[entry.slot];
  if (lane) (runtime[lane] as RuntimeCatalogEntry[]).push(entry);
}

/** Convert a typed closure into the existing isolated Avatar preview runtime. */
export function actionPreviewTarget(
  preview: PyActionPreview,
  label: string,
): ContentPreviewTarget {
  const t = getI18n().getFixedT(null, "actionEditor");
  const closure = actionClosure(preview);
  const root = closure.root;
  const rootType = String(root.content_type);
  const implementation = object(root.implementation);
  const rootSlot: RuntimeContentSlot =
    rootType === "reaction" ? "reaction" : "gesture";
  const rootKind: RuntimeResourceKind =
    implementation.kind === "vrma" ? "animation" : "anima_pose_clip";
  const rootRuntimeId =
    rootType === "reaction"
      ? logicalKeyLeaf(exactSource(root).logical_key) ||
        `${String(object(root.placement_hint).emotion)}-${String(object(root.placement_hint).intensity)}`
      : String(root.semantic_key);
  const rootEntry = nodeEntry(preview, root, rootSlot, rootRuntimeId, rootKind);
  const baseTarget = {
    key: `typed-action:${preview.preview_id}:${preview.revision}`,
    kind: rootKind,
    displayName: label,
    versionLabel: t("preview.versions.exactSaved"),
    slot: rootSlot,
    runtimeId: rootRuntimeId,
    configSchemaVersion: 1,
    config: rootEntry.config,
  } as const;
  const runtime = buildLibraryPreviewRuntime(
    { ...baseTarget, sourceType: "resolved_entry", entry: rootEntry },
    rootEntry,
  );
  const supportById = new Map(
    closure.supports.map((node) => [String(node.runtime_id), node]),
  );
  for (const [runtimeId, support] of supportById) {
    const contentType = String(support.content_type);
    append(
      runtime,
      nodeEntry(
        preview,
        support,
        supportSlot(support),
        runtimeId,
        kindsByType[contentType]!,
      ),
    );
  }
  runtime.effective_revision = `typed-preview:${preview.revision}`;
  return {
    ...baseTarget,
    sourceType: "resolved_action",
    entry: rootEntry,
    runtime,
  };
}

/**
 * Add root-local aliases for the unsaved creator document. Runtime snapshots
 * keep opaque IDs globally; the authoring document intentionally uses the
 * portable aliases declared by its root reference map.
 */
export function creatorActionPreviewRuntime(
  runtime: AnimaRuntimeCatalogSnapshot,
): AnimaRuntimeCatalogSnapshot {
  const root = runtime.gestures[0] ?? runtime.reactions[0] ?? null;
  const referenceMap = object(root?.config).runtime_reference_map;
  if (!referenceMap || typeof referenceMap !== "object") return runtime;
  const lanes = [
    "particle_vfx",
    "avatar_vfx",
    "scene_background_vfx",
    "scene_focus_vfx",
    "sfx",
  ] as const;
  const next = {
    ...runtime,
    particle_vfx: [...runtime.particle_vfx],
    avatar_vfx: [...runtime.avatar_vfx],
    scene_background_vfx: [...runtime.scene_background_vfx],
    scene_focus_vfx: [...runtime.scene_focus_vfx],
    sfx: [...runtime.sfx],
  };
  for (const [alias, runtimeId] of Object.entries(
    referenceMap as Record<string, unknown>,
  )) {
    for (const lane of lanes) {
      const source = next[lane].find(
        (entry) => entry.runtime_id === String(runtimeId),
      );
      if (!source || next[lane].some((entry) => entry.runtime_id === alias))
        continue;
      next[lane].push({ ...source, runtime_id: alias });
      break;
    }
  }
  return next;
}
