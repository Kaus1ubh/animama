import {
  deleteContentItemV1ContentItemsItemIdDelete,
  getContentItemV1ContentItemsItemIdGet,
  getGesture,
  getReaction,
  listContentCatalogV1ContentCatalogGet,
  previewAppearanceContent,
  previewAvatarContent,
  saveAvatarEffect,
  previewAvatarEffect,
  previewGesture,
  previewIdleStyle,
  previewParticleEffect,
  previewPose,
  previewReaction,
  previewSceneEffect,
  previewSoundEffect,
  previewVoiceContent,
  saveAppearanceContent,
  saveAvatarContent,
  saveGesture,
  saveIdleStyle,
  saveParticleEffect,
  savePose,
  saveReaction,
  saveSceneEffect,
  saveSoundEffect,
  saveVoiceContent,
} from "@animama/runtime-contracts/sdk";
import type {
  PyAppearance,
  PyAvatarContent,
  PyAvatarEffect,
  PyContentItem,
  PyGesture,
  PyIdleStyle,
  PyParticleEffect,
  PyPose,
  PyReaction,
  PySceneEffect,
  PySoundEffect,
  PyTypedContentPreview,
  PyVoiceContent,
} from "@animama/runtime-contracts/api-types";
import type { ContentKind, PyContentPreview } from "@/lib/content/catalogTypes";
import { toContentSaveApiError } from "@/lib/content/contentSaveErrors";
import { typedLogicalResourceFiles } from "@/lib/content/typedLogicalResources";
import { typedComponentPreviewMetadata } from "@/lib/content/typedPreviewAdapters";

type TypedCatalogTransport =
  | (PyGesture & { kind: "gesture" })
  | (PyReaction & { kind: "reaction" })
  | (PyPose & { kind: "pose" })
  | (PyParticleEffect & { kind: "particle_effect" })
  | (PyAvatarEffect & { kind: "avatar_effect" })
  | (PySceneEffect & { kind: "scene_effect" })
  | (PySoundEffect & { kind: "sound_effect" })
  | (PyIdleStyle & { kind: "idle_style" })
  | (PyAvatarContent & { kind: "avatar" })
  | (PyAppearance & { kind: "appearance" })
  | (PyVoiceContent & { kind: "voice" });

export type CatalogSaveInput = {
  kind: ContentKind;
  entryName: string;
  files: File[];
  operationId?: string;
  catalogItemId?: string | null;
  expectedRevision?: string | null;
  descriptor?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  companionPaths?: string[];
};

type ContentSaveResponse<T> = {
  data: T | undefined;
  error: unknown;
  response: Response;
};

/** Preserve generated-client HTTP context while exposing one real Save error. */
async function contentSaveData<T>(
  request: Promise<ContentSaveResponse<T>>,
): Promise<T> {
  let result: ContentSaveResponse<T>;
  try {
    result = await request;
  } catch (cause) {
    throw toContentSaveApiError(cause);
  }
  if (result.error !== undefined) {
    throw toContentSaveApiError(result.error, result.response.status);
  }
  if (result.data === undefined) {
    throw toContentSaveApiError({}, result.response.status);
  }
  return result.data;
}

/** Build a portable logical key for a newly authored Local item. */
export function localContentLogicalKey(
  kind: ContentKind,
  name: string,
): string {
  const stem =
    name
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "untitled";
  return `local:${kind.replaceAll("_", "-")}:${stem}`;
}

function typedMetadata(item: TypedCatalogTransport): Record<string, unknown> {
  const common = {
    schema_version: 1,
    content_type: item.kind,
    content_id: item.logical_key,
    name: item.name,
    description: item.description,
    dependencies: item.dependencies ?? [],
    files: item.files ?? [],
    logical_resource_files: typedLogicalResourceFiles(item),
  };
  switch (item.kind) {
    case "gesture":
      return {
        ...common,
        semantic_key: item.semantic_key,
        implementation: item.implementation,
        config: item.config,
      };
    case "reaction":
      return {
        ...common,
        ...(item.emotion && item.intensity
          ? {
              placement_hint: {
                emotion: item.emotion,
                intensity: item.intensity,
              },
            }
          : {}),
        implementation: item.implementation,
        config: item.config,
      };
    case "pose":
      return { ...common, id: item.pose_id };
    case "particle_effect":
      return {
        ...common,
        runtime_defaults: item.runtime_defaults,
        definition: item.definition,
      };
    case "avatar_effect":
    case "scene_effect":
      return {
        ...common,
        runtime_defaults: item.runtime_defaults,
        technical_source: item.technical_source,
        definition: item.definition,
      };
    case "sound_effect":
      return {
        ...common,
        duration_seconds: item.duration_seconds,
        codec: item.codec,
        defaults: item.defaults,
      };
    case "idle_style":
      return {
        ...common,
        schema_version: item.schema_version,
        default_pool: item.default_pool,
        cells: item.cells,
        compatibility: item.compatibility,
      };
    case "avatar":
      return { ...common, compatibility: item.compatibility };
    case "appearance":
      return {
        ...common,
        width: item.width,
        height: item.height,
        avatar_model: item.avatar_model,
        presentation: item.presentation,
      };
    case "voice":
      return {
        ...common,
        codec: item.codec,
        language: item.language,
        sample_rate_hz: item.sample_rate_hz,
      };
  }
}

/** Temporary creator-view adapter; product semantics still come from typed responses. */
export function typedCatalogTransportItem(
  item: TypedCatalogTransport,
): PyContentItem {
  return {
    item_id: item.item_id,
    source: item.source,
    scope: item.source === "included" ? "included" : "owner",
    kind: item.kind,
    // Typed product contracts intentionally do not expose host locators.
    relative_locator: "",
    logical_key: item.logical_key ?? null,
    display_name: item.name,
    status: "valid",
    revision_sha256: item.revision_sha256,
    dependencies: (item.dependencies ?? []).map((dependency) => dependency.ref),
    provenance: {},
    metadata: typedMetadata(item),
    diagnostics: [],
    files: (item.files ?? []).map((file) => ({
      ...file,
      relative_path: file.filename,
    })),
    scanned_at: null,
    name: item.name,
    description: item.description ?? null,
    semantic_key: item.kind === "gesture" ? item.semantic_key : null,
    implementation_kind:
      item.kind === "gesture" || item.kind === "reaction"
        ? item.implementation.kind
        : null,
    origin: item.source,
    editable: item.editable,
    selection: {
      type: "catalog",
      catalog_item_id: item.item_id,
      logical_key: item.logical_key ?? null,
    },
  };
}

/** Save ordinary editable files through the one neutral Content endpoint. */
export async function saveCatalogItem(
  input: CatalogSaveInput,
): Promise<PyContentItem> {
  const body = {
    operation_id: input.operationId ?? crypto.randomUUID(),
    files: input.files,
    catalog_item_id: input.catalogItemId ?? undefined,
    expected_revision: input.expectedRevision ?? undefined,
    descriptor_json: input.descriptor
      ? `${JSON.stringify(input.descriptor, null, 2)}\n`
      : undefined,
    metadata_json: input.metadata
      ? `${JSON.stringify(input.metadata, null, 2)}\n`
      : undefined,
    companion_paths_json: JSON.stringify(input.companionPaths ?? []),
  };
  const typedOptions = {
    path: { entry_name: input.entryName },
    body,
    requestValidator: undefined,
    responseValidator: undefined,
    throwOnError: false as const,
  };
  let item: TypedCatalogTransport;
  switch (input.kind) {
    case "gesture":
      item = {
        ...(await contentSaveData(saveGesture(typedOptions))),
        kind: "gesture",
      };
      break;
    case "reaction":
      item = {
        ...(await contentSaveData(saveReaction(typedOptions))),
        kind: "reaction",
      };
      break;
    case "pose":
      item = {
        ...(await contentSaveData(savePose(typedOptions))),
        kind: "pose",
      };
      break;
    case "particle_effect":
      item = {
        ...(await contentSaveData(saveParticleEffect(typedOptions))),
        kind: "particle_effect",
      };
      break;
    case "avatar_effect":
      item = {
        ...(await contentSaveData(saveAvatarEffect(typedOptions))),
        kind: "avatar_effect",
      };
      break;
    case "scene_effect":
      item = {
        ...(await contentSaveData(saveSceneEffect(typedOptions))),
        kind: "scene_effect",
      };
      break;
    case "sound_effect":
      item = {
        ...(await contentSaveData(saveSoundEffect(typedOptions))),
        kind: "sound_effect",
      };
      break;
    case "idle_style":
      item = {
        ...(await contentSaveData(saveIdleStyle(typedOptions))),
        kind: "idle_style",
      };
      break;
    case "avatar":
      item = {
        ...(await contentSaveData(saveAvatarContent(typedOptions))),
        kind: "avatar",
      };
      break;
    case "appearance":
      item = {
        ...(await contentSaveData(saveAppearanceContent(typedOptions))),
        kind: "appearance",
      };
      break;
    case "voice":
      item = {
        ...(await contentSaveData(saveVoiceContent(typedOptions))),
        kind: "voice",
      };
      break;
    case "anima":
      throw new Error(
        "Portable Anima content is reserved for the Base Anima phase.",
      );
  }
  return typedCatalogTransportItem(item);
}

/** Preview one known family without falling back to generic metadata routes. */
export async function previewTypedCatalogItem(
  kind: Exclude<ContentKind, "anima">,
  itemId: string,
  signal?: AbortSignal,
): Promise<PyTypedContentPreview> {
  const options = {
    path: { item_id: itemId },
    signal,
    responseValidator: undefined,
    throwOnError: true as const,
  };
  switch (kind) {
    case "gesture":
      return (await previewGesture(options)).data;
    case "reaction":
      return (await previewReaction(options)).data;
    case "pose":
      return (await previewPose(options)).data;
    case "particle_effect":
      return (await previewParticleEffect(options)).data;
    case "avatar_effect":
      return (await previewAvatarEffect(options)).data;
    case "scene_effect":
      return (await previewSceneEffect(options)).data;
    case "sound_effect":
      return (await previewSoundEffect(options)).data;
    case "idle_style":
      return (await previewIdleStyle(options)).data;
    case "avatar":
      return (await previewAvatarContent(options)).data;
    case "appearance":
      return (await previewAppearanceContent(options)).data;
    case "voice":
      return (await previewVoiceContent(options)).data;
  }
}

export function typedPreviewTransport(
  preview: PyTypedContentPreview,
): PyContentPreview {
  const item = typedCatalogTransportItem(preview.item);
  return {
    preview_id: preview.preview_id,
    item_id: item.item_id,
    revision: preview.revision_sha256,
    revision_sha256: preview.revision_sha256,
    expires_at: preview.expires_at,
    files: preview.files,
    item,
    metadata: {
      ...typedMetadata(preview.item),
      ...typedComponentPreviewMetadata(preview),
    },
  };
}

export async function previewCatalogItem(
  itemId: string,
  signal?: AbortSignal,
  knownKind?: Exclude<ContentKind, "anima">,
): Promise<PyContentPreview> {
  const kind = knownKind ?? (await getCatalogItem(itemId)).kind;
  if (kind === "anima") {
    throw new Error("Portable Anima previews are not available yet.");
  }
  return typedPreviewTransport(
    await previewTypedCatalogItem(
      kind as Exclude<ContentKind, "anima">,
      itemId,
      signal,
    ),
  );
}

export async function getCatalogItem(itemId: string): Promise<PyContentItem> {
  return (
    await getContentItemV1ContentItemsItemIdGet({
      path: { item_id: itemId },
      responseValidator: undefined,
      throwOnError: true,
    })
  ).data;
}

/** Read an editable Action through its exact typed product contract. */
export async function getTypedActionCatalogItem(
  kind: "gesture" | "reaction",
  itemId: string,
): Promise<PyContentItem> {
  const options = {
    path: { item_id: itemId },
    responseValidator: undefined,
    throwOnError: true as const,
  };
  const item =
    kind === "gesture"
      ? { ...(await getGesture(options)).data, kind: "gesture" as const }
      : { ...(await getReaction(options)).data, kind: "reaction" as const };
  return typedCatalogTransportItem(item);
}

export async function listCatalogItems(
  kind?: ContentKind,
  signal?: AbortSignal,
) {
  const catalog = (
    await listContentCatalogV1ContentCatalogGet({
      signal,
      responseValidator: undefined,
      throwOnError: true,
    })
  ).data;
  return kind
    ? catalog.items.filter((item) => item.kind === kind)
    : catalog.items;
}

export async function deleteCatalogItem(
  itemId: string,
  expectedRevision: string,
): Promise<void> {
  await deleteContentItemV1ContentItemsItemIdDelete({
    path: { item_id: itemId },
    query: { expected_revision: expectedRevision },
    responseValidator: undefined,
    throwOnError: true,
  });
}
