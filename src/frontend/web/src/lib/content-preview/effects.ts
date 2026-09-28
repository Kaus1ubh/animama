import type {
  AnimaPoseClipEventSink,
  AnimaPoseClipSceneVFXEvent,
  Avatar,
} from "@/lib/avatar";
import type { ParticleVFXPlayRequest } from "@/lib/avatar/particle-vfx/types";
import type { AvatarVFXCatalogEntry } from "@/lib/avatar/vfx/types";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import { buildSceneVFXRuntimeEntry } from "@/lib/scene-vfx/runtime-state";
import type {
  SceneVFXEntry,
  SceneVFXKind,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import type { ParticleVFXCatalogEntry } from "@/lib/avatar/particle-vfx/types";
import type { ContentPreviewTarget } from "./types";
import type { AnimaRuntimeMediaProvider } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

export const CONTENT_PREVIEW_PARTICLE_APPLIED_ID =
  "content-preview:particle-vfx";
export const CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID =
  "content-preview:avatar-vfx";
const CONTENT_PREVIEW_EFFECT_OWNER_ID = "content-preview";

type PreviewEffectCatalog = {
  resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null>;
  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null;
  loadAvatarVFX(runtimeId: string): Promise<AvatarVFXCatalogEntry | null>;
  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null;
  loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null>;
};

type PreviewEffectAvatar = Pick<
  Avatar,
  "particleVFXController" | "vfxController"
>;

export type ContentPreviewEffectCommand =
  | { type: "particle_vfx"; runtimeId: string }
  | { type: "avatar_vfx"; runtimeId: string }
  | {
      type: "scene_vfx";
      runtimeId: string;
      sceneKind: SceneVFXKind;
    };

/** Translate a visual-effect target into one isolated preview command. */
export function contentPreviewEffectCommand(
  target: ContentPreviewTarget,
): ContentPreviewEffectCommand | null {
  switch (target.kind) {
    case "particle_vfx":
      return { type: "particle_vfx", runtimeId: target.runtimeId };
    case "avatar_vfx":
      return { type: "avatar_vfx", runtimeId: target.runtimeId };
    case "scene_vfx":
      return {
        type: "scene_vfx",
        runtimeId: target.runtimeId,
        sceneKind:
          target.slot === "scene_focus_vfx"
            ? "focus_lines"
            : "background_layers",
      };
    default:
      return null;
  }
}

/** Preserve catalog placement while making the preview instance replaceable. */
export function buildParticlePreviewRequest(
  effect: ParticleVFXCatalogEntry,
): ParticleVFXPlayRequest {
  return {
    effectId: effect.id,
    appliedId: CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
    ownerId: CONTENT_PREVIEW_EFFECT_OWNER_ID,
    anchor: effect.defaultAnchor,
    durationSec: Math.min(
      effect.defaultDurationSec,
      effect.performanceBudget.maxDurationSec,
    ),
    followAnchor: effect.defaultFollowAnchor,
    transform: effect.defaultTransform,
  };
}

/** Clear only state owned by this preview session. */
export function clearContentPreviewEffects(args: {
  avatar: PreviewEffectAvatar | null;
  onSceneVFXChange: (entry: SceneVFXRuntimeEntry | null) => void;
  stopApplySound?: () => void;
}): void {
  args.avatar?.particleVFXController?.clearEffect(
    CONTENT_PREVIEW_PARTICLE_APPLIED_ID,
  );
  args.avatar?.vfxController?.removeEffect(
    CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
  );
  args.onSceneVFXChange(null);
  args.stopApplySound?.();
}

/** Preview-owned one-shot audio that never writes into the live scene store. */
export class ContentPreviewApplySoundPlayer {
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private detachAbort: (() => void) | null = null;

  async play(
    catalog: Pick<AnimaRuntimeMediaProvider, "resolveAudio">,
    runtimeId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // A late event from a finished clip must not replace a newer preview.
    if (signal?.aborted) return;
    const generation = ++this.generation;
    this.stopAudio();
    if (signal) {
      const abort = () => {
        if (generation === this.generation) this.stop();
      };
      signal.addEventListener("abort", abort, { once: true });
      this.detachAbort = () => signal.removeEventListener("abort", abort);
    }
    let resolved;
    try {
      resolved = await catalog.resolveAudio("sfx", runtimeId);
    } catch (error) {
      if (generation === this.generation) this.stopAudio();
      throw error;
    }
    if (generation !== this.generation) return;
    if (!resolved || typeof Audio === "undefined") {
      this.stopAudio();
      return;
    }
    const audio = new Audio(resolved.url);
    audio.volume = Math.max(0, Math.min(1, resolved.volume));
    this.audio = audio;
    audio.onended = audio.onerror = () => {
      if (this.audio === audio) this.stopAudio();
    };
    try {
      await audio.play();
    } catch {
      if (this.audio === audio) this.stopAudio();
    }
  }

  stop = (): void => {
    this.generation += 1;
    this.stopAudio();
  };

  private stopAudio(): void {
    this.detachAbort?.();
    this.detachAbort = null;
    const audio = this.audio;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.currentTime = 0;
    this.audio = null;
  }
}

export type ContentPreviewClipEventBridge = {
  sink: AnimaPoseClipEventSink;
  reset: () => void;
};

type ContentPreviewClipEventAvatar = Pick<
  Avatar,
  "setPoseClipExternalEventSink" | "setReactionClipExternalEventSink"
>;

/** Attach the React-owned Scene/SFX bridge to both Action clip players. */
export function attachContentPreviewClipEventBridge(
  avatar: ContentPreviewClipEventAvatar,
  bridge: ContentPreviewClipEventBridge,
): () => void {
  avatar.setPoseClipExternalEventSink(bridge.sink);
  avatar.setReactionClipExternalEventSink(bridge.sink);
  return () => {
    bridge.reset();
    avatar.setPoseClipExternalEventSink(null);
    avatar.setReactionClipExternalEventSink(null);
  };
}

/**
 * Bridge clip-owned Scene VFX and SFX into an isolated preview surface.
 * Avatar/Particle VFX remain owned by the preview Avatar itself.
 */
export function createContentPreviewClipEventBridge(args: {
  catalog: Pick<PreviewEffectCatalog, "loadSceneVFX">;
  onSceneVFXChange: (entry: SceneVFXRuntimeEntry | null) => void;
  playSfx: (runtimeId: string, signal?: AbortSignal) => void | Promise<void>;
}): ContentPreviewClipEventBridge {
  let generation = 0;
  let pendingAppliedId: string | null = null;
  let activeAppliedId: string | null = null;

  const reset = () => {
    generation += 1;
    pendingAppliedId = null;
    activeAppliedId = null;
    args.onSceneVFXChange(null);
  };

  const applySceneVFX: NonNullable<
    AnimaPoseClipEventSink["applySceneVFX"]
  > = async (event: AnimaPoseClipSceneVFXEvent, context) => {
    const requestGeneration = generation;
    pendingAppliedId = context.appliedId;
    const effect = await args.catalog.loadSceneVFX(
      event.sceneKind,
      event.presetId,
    );
    if (
      requestGeneration !== generation ||
      pendingAppliedId !== context.appliedId ||
      context.signal?.aborted
    ) {
      return;
    }
    pendingAppliedId = null;
    if (!effect?.enabled) return;
    activeAppliedId = context.appliedId;
    args.onSceneVFXChange(
      buildSceneVFXRuntimeEntry(
        {
          ...effect,
          id: context.appliedId,
          durationMs: null,
        },
        Date.now(),
        effect.id,
      ),
    );
    if (event.playAccompanyingSound !== false && effect.sound?.onApply)
      await args.playSfx(effect.sound.onApply, context.signal);
  };

  const clearSceneVFX: NonNullable<AnimaPoseClipEventSink["clearSceneVFX"]> = (
    _event,
    context,
  ) => {
    if (pendingAppliedId === context.appliedId) pendingAppliedId = null;
    if (activeAppliedId !== context.appliedId) return;
    activeAppliedId = null;
    args.onSceneVFXChange(null);
  };

  return {
    reset,
    sink: {
      applySceneVFX,
      clearSceneVFX,
      playSfx: (event, context) => args.playSfx(event.cueId, context.signal),
    },
  };
}

/** Resolve and play one effect without mutating live chat scene state. */
export async function playContentPreviewEffect(args: {
  avatar: PreviewEffectAvatar;
  catalog: PreviewEffectCatalog;
  command: ContentPreviewEffectCommand;
  onSceneVFXChange: (entry: SceneVFXRuntimeEntry | null) => void;
  isCurrent?: () => boolean;
  playApplySound?: (runtimeId: string) => void | Promise<void>;
  stopApplySound?: () => void;
}): Promise<void> {
  clearContentPreviewEffects(args);

  if (args.command.type === "particle_vfx") {
    const effect = await args.catalog.resolveParticleVFX(
      args.command.runtimeId,
    );
    if (args.isCurrent?.() === false) return;
    if (!effect)
      throw new Error("The selected particle effect is unavailable.");
    const controller = args.avatar.particleVFXController;
    if (!controller)
      throw new Error("The preview avatar cannot play particles.");
    const didPlay = await controller.playEffect(
      buildParticlePreviewRequest(effect),
    );
    if (!didPlay)
      throw new Error("The selected particle effect could not play.");
    return;
  }

  if (args.command.type === "avatar_vfx") {
    const effect = await args.catalog.loadAvatarVFX(args.command.runtimeId);
    if (args.isCurrent?.() === false) return;
    if (!effect) throw new Error("The selected avatar effect is unavailable.");
    const didApply = await applyAvatarVFXEffectById({
      avatar: args.avatar as Avatar,
      effectId: effect.id,
      appliedEffectId: CONTENT_PREVIEW_AVATAR_VFX_APPLIED_ID,
      effectEntry: effect,
    });
    if (!didApply)
      throw new Error("The selected avatar effect could not play.");
    if (effect.sound?.onApply)
      await args.playApplySound?.(effect.sound.onApply);
    return;
  }

  const effect = await args.catalog.loadSceneVFX(
    args.command.sceneKind,
    args.command.runtimeId,
  );
  if (args.isCurrent?.() === false) return;
  if (!effect || !effect.enabled) {
    throw new Error("The selected scene effect is unavailable.");
  }
  args.onSceneVFXChange(buildSceneVFXRuntimeEntry(effect));
  if (effect.sound?.onApply) await args.playApplySound?.(effect.sound.onApply);
}
