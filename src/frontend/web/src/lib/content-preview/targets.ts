import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "./types";
import { contentPreviewRequiresAnimaContext } from "./types";

export type LibraryPreviewAnimaContextState =
  | "not_required"
  | "loading"
  | "ready"
  | "animas_unavailable"
  | "anima_required"
  | "runtime_unavailable";

/** Resolve the strict Anima-context state before preparing a Library target. */
export function resolveLibraryPreviewAnimaContextState(input: {
  target: ContentPreviewTarget | null;
  active: boolean;
  settingsLoading: boolean;
  animasPending: boolean;
  animasError: boolean;
  previewAnima: PyAnimaListItem | null;
  runtimePending: boolean;
  runtimeError: boolean;
  runtimeAvailable: boolean;
}): LibraryPreviewAnimaContextState {
  if (
    !input.target ||
    !input.active ||
    input.target.animaContext ||
    !contentPreviewRequiresAnimaContext(input.target)
  ) {
    return "not_required";
  }
  if (input.settingsLoading || input.animasPending) return "loading";
  if (input.animasError) return "animas_unavailable";
  if (!input.previewAnima) return "anima_required";
  if (input.runtimePending) return "loading";
  if (input.runtimeError || !input.runtimeAvailable)
    return "runtime_unavailable";
  return "ready";
}

/** Select the remembered owned Anima, or the first owned fallback. */
export function selectLibraryPreviewAnima(
  animas: readonly PyAnimaListItem[],
  rememberedAnimaId: string | null | undefined,
): PyAnimaListItem | null {
  return (
    animas.find((anima) => anima.id === rememberedAnimaId) ?? animas[0] ?? null
  );
}

/** Overlay one exact typed target onto an immutable Anima runtime context. */
export function withLibraryPreviewAnimaContext(
  target: ContentPreviewTarget,
  animaId: string,
  runtime: AnimaRuntimeCatalogSnapshot,
): ContentPreviewTarget {
  return {
    ...target,
    key: `${target.key}:anima:${animaId}:${runtime.effective_revision}`,
    animaContext: { animaId, runtime },
  };
}

function assignEntry(
  runtime: AnimaRuntimeCatalogSnapshot,
  entry: RuntimeCatalogEntry,
): void {
  const lanes: Partial<
    Record<RuntimeContentSlot, keyof AnimaRuntimeCatalogSnapshot>
  > = {
    idle_animation: "idle_animations",
    gesture: "gestures",
    pose: "poses",
    reaction: "reactions",
    particle_vfx: "particle_vfx",
    avatar_vfx: "avatar_vfx",
    scene_background_vfx: "scene_background_vfx",
    scene_focus_vfx: "scene_focus_vfx",
    sfx: "sfx",
  };
  const lane = lanes[entry.slot];
  if (lane) (runtime[lane] as RuntimeCatalogEntry[]).push(entry);
}

function mergeEntries(
  current: readonly RuntimeCatalogEntry[],
  overlay: readonly RuntimeCatalogEntry[],
): RuntimeCatalogEntry[] {
  const replacements = new Set(
    overlay.map((entry) => `${entry.slot}:${entry.runtime_id}`),
  );
  return [
    ...current.filter(
      (entry) => !replacements.has(`${entry.slot}:${entry.runtime_id}`),
    ),
    ...overlay,
  ];
}

/** Mount a complete action closure over one selected Anima catalog. */
function buildActionPreviewRuntime(
  target: Extract<ContentPreviewTarget, { sourceType: "resolved_action" }>,
): AnimaRuntimeCatalogSnapshot {
  if (!target.animaContext) return target.runtime;
  const current = target.animaContext.runtime;
  const closure = target.runtime;
  const avatar = current.avatar_model;
  return {
    ...current,
    effective_revision: `preview:${current.effective_revision}:${closure.effective_revision}`,
    avatar_model: avatar
      ? {
          ...avatar,
          content_revision: `anima:${target.animaContext.animaId}:${avatar.content_revision}`,
        }
      : null,
    idle_animations: mergeEntries(
      current.idle_animations,
      closure.idle_animations,
    ),
    gestures: mergeEntries(current.gestures, closure.gestures),
    poses: mergeEntries(current.poses, closure.poses),
    reactions: mergeEntries(current.reactions, closure.reactions),
    particle_vfx: mergeEntries(current.particle_vfx, closure.particle_vfx),
    avatar_vfx: mergeEntries(current.avatar_vfx, closure.avatar_vfx),
    scene_background_vfx: mergeEntries(
      current.scene_background_vfx,
      closure.scene_background_vfx,
    ),
    scene_focus_vfx: mergeEntries(
      current.scene_focus_vfx,
      closure.scene_focus_vfx,
    ),
    sfx: mergeEntries(current.sfx, closure.sfx),
    warnings: [...current.warnings, ...closure.warnings],
  };
}

/** Build the smallest player catalog that exercises one typed preview entry. */
export function buildLibraryPreviewRuntime(
  target: ContentPreviewTarget,
  entry: RuntimeCatalogEntry,
): AnimaRuntimeCatalogSnapshot {
  const runtime: AnimaRuntimeCatalogSnapshot = {
    schema_version: 1,
    effective_revision: `preview:${entry.content_revision}`,
    loadout_revision: 0,
    app_catalog_version: 1,
    avatar_model: target.kind === "avatar_model" ? entry : null,
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    warnings: [],
  };
  if (target.kind !== "avatar_model") assignEntry(runtime, entry);
  for (const support of target.supportEntries ?? [])
    assignEntry(runtime, support);
  return runtime;
}

/** Build the isolated runtime for either Creator Studio or Anima preview. */
export function buildContentPreviewRuntime(
  target: ContentPreviewTarget,
  entry: RuntimeCatalogEntry,
): AnimaRuntimeCatalogSnapshot {
  if (target.sourceType === "resolved_action") {
    return buildActionPreviewRuntime(target);
  }
  if (!target.animaContext) return buildLibraryPreviewRuntime(target, entry);
  const runtime = target.animaContext.runtime;
  const replace = (entries: readonly RuntimeCatalogEntry[]) => {
    const next = entries.filter(
      (candidate) =>
        candidate.slot !== entry.slot ||
        candidate.runtime_id !== entry.runtime_id,
    );
    next.push(entry);
    return next;
  };
  const avatar = entry.slot === "primary_model" ? entry : runtime.avatar_model;
  const preview: AnimaRuntimeCatalogSnapshot = {
    ...runtime,
    effective_revision: `preview:${runtime.effective_revision}:${entry.content_revision}`,
    avatar_model: avatar
      ? {
          ...avatar,
          content_revision: `anima:${target.animaContext.animaId}:${avatar.content_revision}`,
        }
      : null,
    idle_animations: [...runtime.idle_animations],
    gestures: [...runtime.gestures],
    poses: [...runtime.poses],
    reactions: [...runtime.reactions],
    particle_vfx: [...runtime.particle_vfx],
    avatar_vfx: [...runtime.avatar_vfx],
    scene_background_vfx: [...runtime.scene_background_vfx],
    scene_focus_vfx: [...runtime.scene_focus_vfx],
    sfx: [...runtime.sfx],
    warnings: [...runtime.warnings],
  };
  if (entry.slot === "idle_animation")
    preview.idle_animations = replace(runtime.idle_animations);
  else if (entry.slot === "gesture")
    preview.gestures = replace(runtime.gestures);
  else if (entry.slot === "pose") preview.poses = replace(runtime.poses);
  else if (entry.slot === "reaction")
    preview.reactions = replace(runtime.reactions);
  else if (entry.slot === "particle_vfx")
    preview.particle_vfx = replace(runtime.particle_vfx);
  else if (entry.slot === "avatar_vfx")
    preview.avatar_vfx = replace(runtime.avatar_vfx);
  else if (entry.slot === "scene_background_vfx")
    preview.scene_background_vfx = replace(runtime.scene_background_vfx);
  else if (entry.slot === "scene_focus_vfx")
    preview.scene_focus_vfx = replace(runtime.scene_focus_vfx);
  else if (entry.slot === "sfx") preview.sfx = replace(runtime.sfx);
  for (const support of target.supportEntries ?? []) {
    if (support.slot !== "sfx") continue;
    const lane = preview.sfx;
    if (
      !lane.some((candidate) => candidate.runtime_id === support.runtime_id)
    ) {
      lane.push(support);
    }
  }
  return preview;
}

export function contentPreviewAvatarKey(
  runtime: AnimaRuntimeCatalogSnapshot,
): string {
  return runtime.avatar_model?.content_revision ?? "missing-avatar";
}
