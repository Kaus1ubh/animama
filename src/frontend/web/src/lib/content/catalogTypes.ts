/**
 * Frontend view models for the neutral Content Catalog.
 *
 * Generated transport models remain re-exported here. The additional models
 * describe compact UI projections over ordinary editable catalog items.
 */
export * from "@animama/runtime-contracts/api-types";

import {
  contentThumbnailUrl,
  particleThumbnailSource,
} from "./contentThumbnail";

import type {
  PyGesture as PyTransportGesture,
  PyIdlePlayback,
  PyIdleStyle as PyTransportIdleStyle,
  PyAvatarEffect as PyTransportAvatarEffect,
  PyParticleEffect as PyTransportParticleEffect,
  PyReaction as PyTransportReaction,
  PySceneEffect as PyTransportSceneEffect,
  PySoundEffect as PyTransportSoundEffect,
  PyAvatarResponse as PyTransportAvatarResponse,
  PyContentFile as PyTransportContentFile,
  PyContentItem as PyTransportContentItem,
} from "@animama/runtime-contracts/api-types";

export type ContentKind =
  | "avatar"
  | "gesture"
  | "pose"
  | "reaction"
  | "particle_effect"
  | "avatar_effect"
  | "scene_effect"
  | "sound_effect"
  | "idle_style"
  | "appearance"
  | "voice"
  | "anima";

export type PyCatalogSource = {
  type: "catalog";
  catalog_item_id: string;
  logical_key?: string | null;
  /** Physical library partition used when this source becomes a loadout intent. */
  source?: "included" | "local";
};

export type PyBuiltinSource = {
  type: "builtin";
  content_id: string;
  version: number;
};

export type PyExactContentSource = PyCatalogSource | PyBuiltinSource;

/**
 * Files and previews deliberately retain the small authoring shape consumed by
 * preview players. New transport fields are optional here so fixtures can stay
 * focused on the byte facts they exercise.
 */
export type PyContentFile = Partial<PyTransportContentFile> & {
  file_ref: string;
  role: string;
  ordinal: number;
  filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
};

export type PyContentPreviewFile = PyContentFile & { url: string };

export type PyContentPreview = {
  preview_id: string;
  item_id?: string;
  revision: string;
  revision_sha256: string;
  expires_at: string;
  files: PyContentPreviewFile[];
  item?: PyTransportContentItem;
  metadata: Record<string, unknown>;
};

export type PyAvatarResponse = PyTransportAvatarResponse;

export type PyContentDependency = {
  alias: string;
  content_type:
    | "particle_effect"
    | "avatar_effect"
    | "scene_effect"
    | "sound_effect";
  source: PyExactContentSource;
  config?: Record<string, unknown>;
};

export type PyCatalogViewItem = Partial<
  Omit<PyTransportContentItem, "source" | "origin" | "selection">
> & {
  item_id: string;
  name: string;
  display_name?: string;
  description: string | null;
  /** Physical partition remains available without overloading `source`. */
  catalog_source?: PyTransportContentItem["source"];
  source: PyExactContentSource | null;
  origin: "owned" | "builtin";
  state: "ready" | "invalid" | "missing";
  created_at: string | null;
  updated_at: string | null;
  included_resource_counts?: Record<string, number>;
  update_available?: boolean;
  thumbnail_url?: string | null;
  particle_thumbnail?: {
    manifestUrl: string;
    texturePath: string;
    revision: string;
  };
};

type TypedCatalogView<T extends { source: "included" | "local" }> = Partial<
  Omit<T, "source" | "description">
> &
  PyCatalogViewItem;

export type PyGesture = TypedCatalogView<PyTransportGesture> & {
  implementation_kind: "anima_clip" | "vrma";
};
export type PyReaction = TypedCatalogView<PyTransportReaction>;
export type PyParticleEffect = PyCatalogViewItem;
export type PyAvatarEffect = PyCatalogViewItem;
export type PySceneEffect = PyCatalogViewItem;
export type PySoundEffect = PyCatalogViewItem;
export type PyIdleStyle = Omit<
  TypedCatalogView<PyTransportIdleStyle>,
  "dependencies"
> &
  Pick<Partial<PyTransportIdleStyle>, "dependencies">;

export type PyContentPage<
  T extends Omit<PyCatalogViewItem, "dependencies"> = PyCatalogViewItem,
> = {
  items: T[];
  next_cursor: string | null;
  query: Record<string, unknown>;
};
export type PyGesturePage = PyContentPage<PyGesture>;
export type PyReactionPage = PyContentPage<PyReaction>;
export type PyIdleStylePage = PyContentPage<PyIdleStyle>;

export type PyActionPreview = PyContentPreview & {
  closure: Record<string, unknown>;
};
export type PyIdleStylePreview = PyActionPreview & {
  idle_playback: PyIdlePlayback;
  selected_gesture_ref: string;
  selected_gesture_name: string;
};
export type PyGestureBinding = {
  binding_id: string;
  name: string;
  description?: string | null;
  semantic_key: string;
  origin: "starter" | "custom";
  implementation_kind: "anima_clip" | "vrma";
  logical_item_id?: string | null;
  source?: PyExactContentSource | null;
  config_overrides?: Record<string, unknown>;
  update_available?: boolean;
};

export type PyReactionCell = {
  emotion: string;
  intensity: number;
  state: "starter" | "custom" | "empty";
  binding_id?: string | null;
  logical_item_id?: string | null;
  name?: string | null;
  source?: PyExactContentSource | null;
  config_overrides?: Record<string, unknown>;
  update_available?: boolean;
};

export type PyIdleAnimationSummary = {
  animation_id: string;
  name: string;
  description?: string | null;
};

export type PyAnimaIdleStyle = {
  state: "starter" | "custom" | "empty";
  name?: string | null;
  description?: string | null;
  source?: PyExactContentSource | null;
  animations?: PyIdleAnimationSummary[];
  release_default_pool?: string[];
  release_emotion_pools?: Record<string, string[]>;
  effective_default_pool?: string[];
  effective_emotion_pools?: Record<string, string[]>;
  pool_overrides?: Record<string, string[]>;
  cross_fade_seconds?: number;
};

export type PyAppearanceConfig = {
  fit?: "cover" | "contain";
  focal_x?: number;
  focal_y?: number;
  zoom?: number;
};
export type PyAnimaAppearance = {
  binding_id: string;
  use: "profile" | "background";
  item_id: string;
  name: string;
  source: PyExactContentSource;
  width: number;
  height: number;
  presentation: PyAppearanceConfig;
};

export type PyAnimaLoadout = {
  anima_id: string;
  revision: number;
  starter_version: number;
  gestures: PyGestureBinding[];
  disabled_starter_gestures: string[];
  starter_gesture_implementation_kinds?: Record<string, "anima_clip" | "vrma">;
  reactions: PyReactionCell[];
  idle_style: PyAnimaIdleStyle;
  avatar_source?: Record<string, unknown> | null;
  appearances?: PyAnimaAppearance[];
  blockers?: PyLoadoutDiagnostic[];
  warnings?: PyLoadoutDiagnostic[];
};

export type PyLoadoutDiagnostic = {
  code: string;
  message: string;
  scope?: string | null;
};
export type PyLoadoutPlan = {
  action:
    | "add"
    | "update"
    | "replace"
    | "remove"
    | "revert"
    | "leave_empty"
    | "unchanged"
    | "blocked";
  plan_digest: string;
  current_name?: string | null;
  target_name?: string | null;
  included_resource_counts?: Record<string, number>;
  final_gesture_count: number;
  blockers?: PyLoadoutDiagnostic[];
  warnings?: PyLoadoutDiagnostic[];
};

export type PyGestureIntent = Record<string, unknown> & {
  operation: string;
  source?: PyExactContentSource | null;
};
export type PyReactionIntent = PyGestureIntent;
export type PyIdleStyleIntent = PyGestureIntent & {
  pool_overrides?: Record<string, string[]>;
};
export type PyAppearanceIntent = PyGestureIntent & {
  use?: "profile" | "background";
};

export type PyGesturePlanRequest = {
  expected_revision: number;
  intent: PyGestureIntent;
};
export type PyReactionPlanRequest = {
  expected_revision: number;
  intent: PyReactionIntent;
};
export type PyIdleStylePlanRequest = {
  expected_revision: number;
  intent: PyIdleStyleIntent;
};
export type PyAppearancePlanRequest = {
  expected_revision: number;
  intent: PyAppearanceIntent;
};
export type PyGestureCommitRequest = PyGesturePlanRequest & {
  plan_digest: string;
  idempotency_key: string;
};
export type PyReactionCommitRequest = PyGestureCommitRequest;
export type PyIdleStyleCommitRequest = PyGestureCommitRequest;
export type PyAppearanceCommitRequest = PyGestureCommitRequest;
/** Convert one transport item into the stable UI view used by creators. */
export function catalogViewItem(
  item: PyTransportContentItem,
): PyCatalogViewItem {
  const source: PyCatalogSource = {
    type: "catalog",
    catalog_item_id: item.item_id,
    logical_key: item.logical_key,
    source: item.source,
  };
  return {
    ...item,
    catalog_source: item.source,
    source,
    origin: item.source === "included" ? "builtin" : "owned",
    state:
      item.status === "valid"
        ? "ready"
        : item.status === "missing"
          ? "missing"
          : "invalid",
    created_at: item.scanned_at,
    updated_at: item.scanned_at,
  };
}

/** Adapt a generated typed product response without re-reading semantic metadata. */
export function typedCatalogViewItem<
  T extends PyTransportGesture | PyTransportReaction | PyTransportIdleStyle,
>(item: T): TypedCatalogView<T> {
  const source: PyCatalogSource = {
    type: "catalog",
    catalog_item_id: item.item_id,
    logical_key: item.logical_key,
    source: item.source,
  };
  return {
    ...item,
    catalog_source: item.source,
    source,
    origin: item.source === "included" ? "builtin" : "owned",
    state: "ready",
    created_at: null,
    updated_at: null,
    ...(item.kind === "gesture"
      ? { implementation_kind: item.implementation.kind }
      : {}),
  } as unknown as TypedCatalogView<T>;
}

type TypedComponent =
  | PyTransportParticleEffect
  | PyTransportAvatarEffect
  | PyTransportSceneEffect
  | PyTransportSoundEffect;

/** Adapt generated Effect/Sound contracts at the remaining editor view boundary. */
export function typedComponentCatalogViewItem(
  item: TypedComponent,
): PyCatalogViewItem {
  const source: PyCatalogSource = {
    type: "catalog",
    catalog_item_id: item.item_id,
    logical_key: item.logical_key,
    source: item.source,
  };
  const metadata = {
    schema_version: 1,
    content_type: item.kind,
    name: item.name,
    description: item.description,
    dependencies: item.dependencies ?? [],
    ...("runtime_defaults" in item
      ? { runtime_defaults: item.runtime_defaults }
      : {}),
    ...("technical_source" in item
      ? { technical_source: item.technical_source }
      : {}),
    ...("definition" in item ? { definition: item.definition } : {}),
    ...("defaults" in item ? { defaults: item.defaults } : {}),
    ...("duration_seconds" in item
      ? { duration_seconds: item.duration_seconds, codec: item.codec }
      : {}),
  };
  return {
    item_id: item.item_id,
    kind: item.kind,
    logical_key: item.logical_key,
    name: item.name,
    display_name: item.name,
    description: item.description ?? null,
    catalog_source: item.source,
    source,
    origin: item.source === "included" ? "builtin" : "owned",
    state: "ready",
    status: "valid",
    revision_sha256: item.revision_sha256,
    thumbnail_url:
      item.kind === "sound_effect"
        ? null
        : contentThumbnailUrl(item.files ?? []),
    particle_thumbnail:
      item.kind === "particle_effect"
        ? particleThumbnailSource(item.files ?? [], item.revision_sha256)
        : undefined,
    editable: item.editable,
    portability: item.portability,
    metadata,
    created_at: null,
    updated_at: null,
  };
}

/** Preserve the generated file shape for callers that build preview targets. */
export function previewFiles(preview: PyContentPreview): PyContentFile[] {
  return preview.item?.files ?? preview.files;
}
