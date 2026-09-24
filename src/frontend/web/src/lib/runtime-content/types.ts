/** Concrete resource kinds understood by the avatar player. */
export const RUNTIME_RESOURCE_KINDS = [
  "document",
  "avatar_model",
  "image",
  "audio",
  "animation",
  "anima_clip",
  "anima_pose_clip",
  "particle_vfx",
  "avatar_vfx",
  "scene_vfx",
  "bundle",
] as const;

export type RuntimeResourceKind = (typeof RUNTIME_RESOURCE_KINDS)[number];

/** Concrete player destinations produced by the runtime resolver. */
export const RUNTIME_CONTENT_SLOTS = [
  "primary_model",
  "idle_animation",
  "gesture",
  "pose",
  "reaction",
  "particle_vfx",
  "avatar_vfx",
  "scene_background_vfx",
  "scene_focus_vfx",
  "background_image",
  "profile_image",
  "sfx",
  "bgm",
] as const;

export type RuntimeContentSlot = (typeof RUNTIME_CONTENT_SLOTS)[number];

/** One revision-scoped private file consumed by the avatar player. */
export type PyRuntimeFile = {
  /** Present for issued runtime files; editor-local data/blob files need none. */
  file_ref?: string;
  role: string;
  ordinal: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Present for issued runtime files; editor-local previews use content_revision. */
  sha256?: string;
  content_revision: string;
  url: string;
};

export type RuntimeCatalogEntry = {
  /** Issued roots whose complete verified closure authorizes this player resource. */
  runtime_root_ids?: readonly string[];
  slot: RuntimeContentSlot;
  runtime_id: string;
  kind: RuntimeResourceKind;
  display_name: string;
  description: string | null;
  config_schema_version: number;
  config: Record<string, unknown>;
  definition?: Record<string, unknown> | null;
  content_revision: string;
  source:
    | { type: "public_url"; url: string }
    | { type: "runtime_catalog"; catalog: string; key: string }
    | {
        type: "authorized_files";
        files: PyRuntimeFile[];
        logical_resource_urls?: Record<string, string>;
      }
    | {
        type: "prepared_files";
        files: PyRuntimeFile[];
        logical_resource_urls?: Record<string, string>;
      };
};

export function runtimeSourceHasFiles(
  source: RuntimeCatalogEntry["source"],
): source is Extract<
  RuntimeCatalogEntry["source"],
  { type: "authorized_files" | "prepared_files" }
> {
  return source.type === "authorized_files" || source.type === "prepared_files";
}

export type AnimaRuntimeCatalogSnapshot = {
  schema_version?: 1;
  effective_revision: string;
  loadout_revision: number;
  app_catalog_version: number;
  avatar_model: RuntimeCatalogEntry | null;
  idle_animations: RuntimeCatalogEntry[];
  /** Missing cells inherit Default; an explicit empty cell suppresses idle motion. */
  idle_style_pools?: {
    default: string[];
    cells: Record<string, Record<string, string[]>>;
  };
  gestures: RuntimeCatalogEntry[];
  poses: RuntimeCatalogEntry[];
  reactions: RuntimeCatalogEntry[];
  particle_vfx: RuntimeCatalogEntry[];
  avatar_vfx: RuntimeCatalogEntry[];
  scene_background_vfx: RuntimeCatalogEntry[];
  scene_focus_vfx: RuntimeCatalogEntry[];
  background_image: RuntimeCatalogEntry | null;
  profile_image: RuntimeCatalogEntry | null;
  sfx: RuntimeCatalogEntry[];
  bgm: RuntimeCatalogEntry[];
  warnings: Array<{
    code: string;
    slot: RuntimeContentSlot;
    runtime_id: string;
  }>;
};

export const RUNTIME_SLOT_COMPATIBLE_KINDS = {
  primary_model: ["avatar_model"],
  idle_animation: ["animation", "anima_pose_clip"],
  gesture: ["animation", "anima_pose_clip"],
  pose: ["anima_pose_clip"],
  reaction: ["anima_pose_clip"],
  particle_vfx: ["particle_vfx"],
  avatar_vfx: ["avatar_vfx"],
  scene_background_vfx: ["scene_vfx"],
  scene_focus_vfx: ["scene_vfx"],
  background_image: ["image"],
  profile_image: ["image"],
  sfx: ["audio"],
  bgm: ["audio"],
} as const satisfies Record<RuntimeContentSlot, readonly RuntimeResourceKind[]>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
