import type { Avatar } from "@/lib/avatar";
import {
  validateAnimaPoseClipEventCatalogRefs,
  type AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip";
import { WordedError } from "@/lib/errors/apiError";
import type { PreviewRuntimeCatalogDelegate } from "./PreviewRuntimeCatalogSession";
import { getI18n } from "react-i18next";
import type { ContentPreviewTarget } from "./types";

export type ContentPreviewMissingDependency = {
  kind:
    | "avatar_vfx"
    | "scene_background_vfx"
    | "scene_focus_vfx"
    | "particle_vfx"
    | "sfx";
  label: string;
  runtimeId: string;
};

/** Display name of a dependency kind, in the UI Locale. */
export function contentPreviewDependencyLabel(
  kind: ContentPreviewMissingDependency["kind"],
): string {
  const t = getI18n().getFixedT(null, "actionEditor");
  switch (kind) {
    case "avatar_vfx":
      return t("preview.dependencies.kinds.avatarEffect");
    case "scene_background_vfx":
      return t("preview.dependencies.kinds.backgroundSceneEffect");
    case "scene_focus_vfx":
      return t("preview.dependencies.kinds.focusSceneEffect");
    case "particle_vfx":
      return t("preview.dependencies.kinds.particleEffect");
    case "sfx":
      return t("preview.dependencies.kinds.sound");
  }
}

export type ContentPreviewPlaybackCommand =
  | { type: "avatar_model" }
  | { type: "idle_animation"; runtimeId: string }
  | { type: "gesture_animation"; runtimeId: string }
  | { type: "pose_clip"; runtimeId: string }
  | { type: "reaction_clip"; runtimeId: string };

export const MAX_CONTENT_PREVIEW_FRAME_DELTA_SEC = 0.1;

/** Exclude preparation time from the first frame and bound resumed frames. */
export function boundedContentPreviewFrameDelta(
  deltaSec: number,
  firstPlaybackFrame = false,
): number {
  if (firstPlaybackFrame) return 0;
  if (!Number.isFinite(deltaSec)) return 0;
  return Math.min(MAX_CONTENT_PREVIEW_FRAME_DELTA_SEC, Math.max(0, deltaSec));
}

/** Keep row components unaware of renderer-specific playback commands. */
export function contentPreviewPlaybackCommand(
  target: ContentPreviewTarget,
): ContentPreviewPlaybackCommand | null {
  switch (target.kind) {
    case "avatar_model":
      return { type: "avatar_model" };
    case "animation":
      return {
        type:
          target.slot === "idle_animation"
            ? "idle_animation"
            : "gesture_animation",
        runtimeId: target.runtimeId,
      };
    case "anima_pose_clip":
      return {
        type: target.slot === "reaction" ? "reaction_clip" : "pose_clip",
        runtimeId: target.runtimeId,
      };
    default:
      return null;
  }
}

export type ContentPreviewMotionPlayback = {
  avatar: Avatar;
  catalog: PreviewRuntimeCatalogDelegate;
  target: ContentPreviewTarget;
  loop: boolean;
  /** Suppress lifecycle callbacks after a newer preview replaces this run. */
  isCurrent?: () => boolean;
  onFinished?: () => void;
  onMissingDependencies?: (
    dependencies: ContentPreviewMissingDependency[],
  ) => void;
  /** Reports the period where exact clip dependencies are being resolved. */
  onDependenciesLoadingChange?: (loading: boolean) => void;
};

const EMPTY_EVENT_CATALOGS = {
  avatarVFXIds: [],
  sceneBackgroundLayerPresetIds: [],
  sceneFocusLinePresetIds: [],
  particleVFXIds: [],
  sfxCueIds: [],
} as const;

function allContentPreviewDependencies(
  clip: AnimaPoseClipV2,
): ContentPreviewMissingDependency[] {
  const references = validateAnimaPoseClipEventCatalogRefs(
    clip,
    EMPTY_EVENT_CATALOGS,
  );
  return [
    ...references.missingAvatarVFXIds.map((runtimeId) => ({
      kind: "avatar_vfx" as const,
      label: contentPreviewDependencyLabel("avatar_vfx"),
      runtimeId,
    })),
    ...references.missingSceneBackgroundLayerPresetIds.map((runtimeId) => ({
      kind: "scene_background_vfx" as const,
      label: contentPreviewDependencyLabel("scene_background_vfx"),
      runtimeId,
    })),
    ...references.missingSceneFocusLinePresetIds.map((runtimeId) => ({
      kind: "scene_focus_vfx" as const,
      label: contentPreviewDependencyLabel("scene_focus_vfx"),
      runtimeId,
    })),
    ...references.missingParticleVFXIds.map((runtimeId) => ({
      kind: "particle_vfx" as const,
      label: contentPreviewDependencyLabel("particle_vfx"),
      runtimeId,
    })),
    ...references.missingSFXCueIds.map((runtimeId) => ({
      kind: "sfx" as const,
      label: contentPreviewDependencyLabel("sfx"),
      runtimeId,
    })),
  ];
}

async function loadContentPreviewDependency(
  dependency: ContentPreviewMissingDependency,
  catalog: PreviewRuntimeCatalogDelegate,
): Promise<boolean> {
  try {
    switch (dependency.kind) {
      case "avatar_vfx":
        return Boolean(await catalog.loadAvatarVFX(dependency.runtimeId));
      case "scene_background_vfx":
        return Boolean(
          await catalog.loadSceneVFX("background_layers", dependency.runtimeId),
        );
      case "scene_focus_vfx":
        return Boolean(
          await catalog.loadSceneVFX("focus_lines", dependency.runtimeId),
        );
      case "particle_vfx":
        return Boolean(await catalog.resolveParticleVFX(dependency.runtimeId));
      case "sfx":
        return Boolean(await catalog.resolveAudio("sfx", dependency.runtimeId));
    }
  } catch {
    return false;
  }
}

/**
 * Resolve every event dependency before diagnosing availability. Private
 * Scene/Avatar VFX are intentionally absent from synchronous catalog lists
 * until their authorized files have loaded.
 */
export async function prepareContentPreviewDependencies(
  clip: AnimaPoseClipV2,
  catalog: PreviewRuntimeCatalogDelegate,
): Promise<ContentPreviewMissingDependency[]> {
  const dependencies = allContentPreviewDependencies(clip);
  if (dependencies.length === 0) return [];
  const results = await Promise.all(
    dependencies.map(async (dependency) => ({
      dependency,
      loaded: await loadContentPreviewDependency(dependency, catalog),
    })),
  );

  const failedLoads = results
    .filter((result) => !result.loaded)
    .map((result) => result.dependency);
  const missingAfterLoading = collectContentPreviewMissingDependencies(
    clip,
    catalog,
  );
  const recomputed = new Map(
    missingAfterLoading.map((dependency) => [
      `${dependency.kind}:${dependency.runtimeId}`,
      dependency,
    ]),
  );
  return failedLoads.map(
    (dependency) =>
      recomputed.get(`${dependency.kind}:${dependency.runtimeId}`) ??
      dependency,
  );
}

/** Report exact event runtime IDs absent from the mounted preview catalog. */
export function collectContentPreviewMissingDependencies(
  clip: AnimaPoseClipV2,
  catalog: PreviewRuntimeCatalogDelegate,
): ContentPreviewMissingDependency[] {
  const missing = validateAnimaPoseClipEventCatalogRefs(clip, {
    avatarVFXIds: catalog.listAvatarVFX().map((entry) => entry.id),
    sceneBackgroundLayerPresetIds: catalog
      .listSceneVFX("background_layers")
      .map((entry) => entry.id),
    sceneFocusLinePresetIds: catalog
      .listSceneVFX("focus_lines")
      .map((entry) => entry.id),
    particleVFXIds: catalog.listParticleVFX().map((entry) => entry.id),
    sfxCueIds: catalog.listAudio("sfx").map((entry) => entry.runtimeId),
  });
  return [
    ...missing.missingAvatarVFXIds.map((runtimeId) => ({
      kind: "avatar_vfx" as const,
      label: contentPreviewDependencyLabel("avatar_vfx"),
      runtimeId,
    })),
    ...missing.missingSceneBackgroundLayerPresetIds.map((runtimeId) => ({
      kind: "scene_background_vfx" as const,
      label: contentPreviewDependencyLabel("scene_background_vfx"),
      runtimeId,
    })),
    ...missing.missingSceneFocusLinePresetIds.map((runtimeId) => ({
      kind: "scene_focus_vfx" as const,
      label: contentPreviewDependencyLabel("scene_focus_vfx"),
      runtimeId,
    })),
    ...missing.missingParticleVFXIds.map((runtimeId) => ({
      kind: "particle_vfx" as const,
      label: contentPreviewDependencyLabel("particle_vfx"),
      runtimeId,
    })),
    ...missing.missingSFXCueIds.map((runtimeId) => ({
      kind: "sfx" as const,
      label: contentPreviewDependencyLabel("sfx"),
      runtimeId,
    })),
  ];
}

/**
 * Execute one renderer-independent motion preview against an existing Avatar.
 * The caller owns resetting prior motion and deciding what "finished" means
 * for its presentation surface.
 */
export async function playContentPreviewMotion({
  avatar,
  catalog,
  target,
  loop,
  isCurrent = () => true,
  onFinished,
  onMissingDependencies,
  onDependenciesLoadingChange,
}: ContentPreviewMotionPlayback): Promise<boolean> {
  const t = getI18n().getFixedT(null, "actionEditor");
  const command = contentPreviewPlaybackCommand(target);
  if (!command || command.type === "avatar_model") return false;

  onMissingDependencies?.([]);

  const finish = () => {
    if (isCurrent()) onFinished?.();
  };
  if (command.type === "gesture_animation") {
    const gesture = catalog.getGesture(command.runtimeId);
    if (!gesture || gesture.type !== "vrma") {
      throw new WordedError(t("preview.errors.animationUnavailable"));
    }
    await avatar.playAnimationWithName(gesture.entry.file, gesture.name, {
      isCurrent,
      loopType: target.idlePlayback?.loopType ?? (loop ? "repeat" : "once"),
      loopCount: target.idlePlayback?.repetitions ?? (loop ? -1 : 1),
      timeScale: target.idlePlayback?.timeScale ?? gesture.timeScale,
      keepExisting: false,
      fadeDuration: 0.25,
      onFinished: target.idlePlayback || !loop ? finish : undefined,
    });
    return true;
  }
  if (command.type === "idle_animation") {
    const idle = catalog
      .getIdleAnimations()
      .find((candidate) => candidate.id === command.runtimeId);
    if (!idle || idle.type !== "vrma") {
      throw new WordedError(t("preview.errors.idleAnimationUnavailable"));
    }
    await avatar.playAnimationWithName(idle.file, idle.name, {
      isCurrent,
      loopType: loop ? "repeat" : "once",
      loopCount: loop ? -1 : 1,
      timeScale: idle.time_scale ?? 1,
      keepExisting: false,
      fadeDuration: 0.25,
      onFinished: loop ? undefined : finish,
    });
    return true;
  }
  if (command.type === "reaction_clip") {
    const clip = await catalog.loadReactionClip(command.runtimeId);
    // Retired while the clip loaded: prepare and report nothing.
    if (!isCurrent()) return false;
    if (!clip) throw new WordedError(t("preview.errors.reactionUnavailable"));
    onDependenciesLoadingChange?.(true);
    try {
      const missing = await prepareContentPreviewDependencies(clip, catalog);
      if (isCurrent()) onMissingDependencies?.(missing);
    } finally {
      if (isCurrent()) onDependenciesLoadingChange?.(false);
    }
    if (!isCurrent()) return false;
    const didPlay = await avatar.playDebugReactionClip(command.runtimeId);
    if (!didPlay)
      throw new WordedError(t("preview.errors.reactionUnavailable"));
    return true;
  }

  const clip = await catalog.loadPoseClip(command.runtimeId);
  if (!isCurrent()) return false;
  if (!clip) throw new WordedError(t("preview.errors.poseClipUnavailable"));
  onDependenciesLoadingChange?.(true);
  try {
    const missing = await prepareContentPreviewDependencies(clip, catalog);
    if (isCurrent()) onMissingDependencies?.(missing);
  } finally {
    if (isCurrent()) onDependenciesLoadingChange?.(false);
  }
  if (!isCurrent()) return false;
  if (target.idlePlayback) {
    // Use the already prepared clip after the stale-run check, with no second
    // async load that could replace a newer preview before playback starts.
    avatar.playAnimaPoseClip(clip, {
      onFinished: finish,
      preserveProceduralOffsets: true,
      finitePlayback: {
        timeScale: target.idlePlayback.timeScale,
        repetitions: target.idlePlayback.repetitions,
      },
    });
  } else {
    await avatar.loadAndPlayClip(command.runtimeId, {
      preserveProceduralOffsets: true,
    });
  }
  return true;
}

/** Explicit intent autoplays once unless the operating system requests less motion. */
export function shouldAutoplayContentPreview(
  prefersReducedMotion: boolean,
): boolean {
  return !prefersReducedMotion;
}
