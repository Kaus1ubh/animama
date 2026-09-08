import type {
  PyContentDependency,
  PyContentPreview,
} from "@/lib/content/catalogTypes";
import { componentPreviewTarget } from "@/lib/content/componentPreviewTarget";
import { contentPreviewFileUrl } from "@/lib/content/contentPreview";
import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "@/lib/runtime-content/types";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function soundEntry(
  preview: PyContentPreview,
  dependency: PyContentDependency,
): RuntimeCatalogEntry {
  const metadata = object(preview.metadata);
  const spec = object(metadata.spec);
  const files = preview.files.map((file) => ({
    file_ref: file.file_ref,
    role: file.role,
    ordinal: file.ordinal,
    filename: file.filename,
    content_type: file.media_type,
    size_bytes: file.size_bytes,
    content_revision: file.sha256,
    url: contentPreviewFileUrl(preview, file),
  }));
  return {
    slot: "sfx",
    runtime_id: dependency.alias,
    kind: "audio",
    display_name: String(metadata.name ?? dependency.alias),
    description: null,
    config_schema_version: 1,
    config: object(spec.defaults ?? metadata.defaults),
    content_revision: preview.revision,
    source: { type: "authorized_files", files },
  };
}

/** Turn one exact typed dependency preview into editor-local runtime entries. */
export function actionComponentSandboxEntries(
  preview: PyContentPreview,
  dependency: PyContentDependency,
): RuntimeCatalogEntry[] {
  if (dependency.content_type === "sound_effect") {
    return [soundEntry(preview, dependency)];
  }
  const target = componentPreviewTarget(
    preview,
    dependency.content_type,
    dependency.alias,
  );
  return [
    { ...target.entry, runtime_id: dependency.alias },
    ...(target.supportEntries ?? []),
  ];
}

const laneBySlot: Partial<
  Record<RuntimeContentSlot, keyof AnimaRuntimeCatalogSnapshot>
> = {
  particle_vfx: "particle_vfx",
  avatar_vfx: "avatar_vfx",
  scene_background_vfx: "scene_background_vfx",
  scene_focus_vfx: "scene_focus_vfx",
  sfx: "sfx",
};

function mergeLane(
  current: readonly RuntimeCatalogEntry[],
  additions: readonly RuntimeCatalogEntry[],
): RuntimeCatalogEntry[] {
  const replacements = new Set(
    additions.map((entry) => `${entry.slot}:${entry.runtime_id}`),
  );
  return [
    ...current.filter(
      (entry) => !replacements.has(`${entry.slot}:${entry.runtime_id}`),
    ),
    ...additions,
  ];
}

/** Overlay dependency resources without changing the selected preview Avatar. */
export function withActionComponentSandbox(
  runtime: AnimaRuntimeCatalogSnapshot | null,
  entries: readonly RuntimeCatalogEntry[],
): AnimaRuntimeCatalogSnapshot | null {
  if (!runtime || entries.length === 0) return runtime;
  const byLane = new Map<
    keyof AnimaRuntimeCatalogSnapshot,
    RuntimeCatalogEntry[]
  >();
  for (const entry of entries) {
    const lane = laneBySlot[entry.slot];
    if (!lane) continue;
    const values = byLane.get(lane) ?? [];
    values.push(entry);
    byLane.set(lane, values);
  }
  const revision = entries
    .map(
      (entry) => `${entry.slot}:${entry.runtime_id}:${entry.content_revision}`,
    )
    .sort()
    .join("|");
  return {
    ...runtime,
    effective_revision: `${runtime.effective_revision}:editor:${revision}`,
    particle_vfx: mergeLane(
      runtime.particle_vfx,
      byLane.get("particle_vfx") ?? [],
    ),
    avatar_vfx: mergeLane(runtime.avatar_vfx, byLane.get("avatar_vfx") ?? []),
    scene_background_vfx: mergeLane(
      runtime.scene_background_vfx,
      byLane.get("scene_background_vfx") ?? [],
    ),
    scene_focus_vfx: mergeLane(
      runtime.scene_focus_vfx,
      byLane.get("scene_focus_vfx") ?? [],
    ),
    sfx: mergeLane(runtime.sfx, byLane.get("sfx") ?? []),
  };
}

/** Mount an editor-only action closure over the selected Anima runtime. */
export function withActionRuntimeOverlay(
  runtime: AnimaRuntimeCatalogSnapshot | null,
  overlay: AnimaRuntimeCatalogSnapshot | null,
): AnimaRuntimeCatalogSnapshot | null {
  if (!runtime || !overlay) return runtime;
  return {
    ...runtime,
    effective_revision: `${runtime.effective_revision}:action:${overlay.effective_revision}`,
    gestures: mergeLane(runtime.gestures, overlay.gestures),
    poses: mergeLane(runtime.poses, overlay.poses),
    reactions: mergeLane(runtime.reactions, overlay.reactions),
    particle_vfx: mergeLane(runtime.particle_vfx, overlay.particle_vfx),
    avatar_vfx: mergeLane(runtime.avatar_vfx, overlay.avatar_vfx),
    scene_background_vfx: mergeLane(
      runtime.scene_background_vfx,
      overlay.scene_background_vfx,
    ),
    scene_focus_vfx: mergeLane(
      runtime.scene_focus_vfx,
      overlay.scene_focus_vfx,
    ),
    sfx: mergeLane(runtime.sfx, overlay.sfx),
    bgm: mergeLane(runtime.bgm, overlay.bgm),
    warnings: [...runtime.warnings, ...overlay.warnings],
  };
}
