import type { AnyAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { parseParticleVFXRuntimeConfig } from "@/lib/avatar/particle-vfx/runtimeConfig";
import type { ParticleVFXCatalogEntry } from "@/lib/avatar/particle-vfx/types";
import { AvatarEffectDefinitionError } from "@/lib/avatar/vfx/definition";
import {
  effectSourceEntry,
  type EffectSource,
} from "@/lib/avatar/vfx/effectSource";
import {
  isAttachmentVFXEntry,
  type AvatarVFXCatalogEntry,
  type AvatarVFXParsedEntry,
} from "@/lib/avatar/vfx/types";
import type { AnimaRuntimeMediaProvider } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

/**
 * Effects for the motion preview page (`scripts/animation-preview`). The
 * preview server resolves an effect source, or the typed dependencies of a
 * Gesture or Reaction, from Included and Local content and serves their files;
 * this module turns them into the runtime media provider an `Avatar` plays
 * clip events through, keyed by dependency alias as in chat.
 */

/** An Avatar Effect source reviewed on its own. */
export type PreviewEffect = EffectSource & {
  /** Seconds the effect stays applied (`--duration`), or null to loop. */
  duration: number | null;
};

/** A Particle Effect dependency: its served manifest and runtime config. */
export type PreviewParticleEffect = {
  alias: string;
  name: string;
  description: string;
  /** Served manifest; its relative texture URLs resolve beside it. */
  manifestUrl: string;
  /** The effect's stored runtime defaults overlaid with the dependency config. */
  config: Record<string, unknown>;
};

/** What a clip's effect events can play, resolved from its dependencies. */
export type PreviewMedia = {
  avatarEffects: { alias: string; effect: EffectSource }[];
  particleEffects: PreviewParticleEffect[];
  /** Dependencies that could not be resolved, with the reason. */
  notices: string[];
};

export const EMPTY_PREVIEW_MEDIA: PreviewMedia = {
  avatarEffects: [],
  particleEffects: [],
  notices: [],
};

/**
 * Runtime media for one preview `Avatar`. Avatar and Particle Effects resolve
 * by alias; Scene Effects and sounds are never available because the chat
 * scene, not the `Avatar`, draws and plays them. `setMedia` swaps the
 * contents when the playing source changes, since an `Avatar` keeps the
 * provider it was created with.
 */
export class PreviewMediaProvider implements AnimaRuntimeMediaProvider {
  private avatarEffects = new Map<string, AvatarVFXParsedEntry>();
  private particleEffects = new Map<string, ParticleVFXCatalogEntry>();
  private problems: string[] = [];

  constructor(media: PreviewMedia = EMPTY_PREVIEW_MEDIA) {
    this.setMedia(media);
  }

  /** Replace the playable effects. Invalid definitions become `problems`. */
  setMedia(media: PreviewMedia): void {
    this.avatarEffects = new Map();
    this.particleEffects = new Map();
    this.problems = [];
    for (const { alias, effect } of media.avatarEffects) {
      try {
        this.avatarEffects.set(alias, effectSourceEntry(effect, alias));
      } catch (error) {
        this.problems.push(
          `Avatar Effect “${alias}” (${effect.name}): ${describeError(error)}`,
        );
      }
    }
    for (const particle of media.particleEffects)
      this.particleEffects.set(particle.alias, {
        id: particle.alias,
        label: particle.name,
        description: particle.description,
        assetPath: particle.manifestUrl,
        ...parseParticleVFXRuntimeConfig(particle.config),
      });
  }

  /** Effects that failed to parse when the media was set. */
  getProblems(): readonly string[] {
    return this.problems;
  }

  listParticleVFX(): readonly ParticleVFXCatalogEntry[] {
    return [...this.particleEffects.values()];
  }

  getParticlePreloadIds(): readonly string[] {
    return [];
  }

  async resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null> {
    return this.particleEffects.get(runtimeId) ?? null;
  }

  listAvatarVFX(): readonly AvatarVFXCatalogEntry[] {
    return [...this.avatarEffects.values()].filter(
      (entry): entry is AvatarVFXCatalogEntry => !isAttachmentVFXEntry(entry),
    );
  }

  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null {
    const entry = this.avatarEffects.get(runtimeId);
    return entry && !isAttachmentVFXEntry(entry) ? entry : null;
  }

  async loadAvatarVFX(runtimeId: string): Promise<AvatarVFXParsedEntry | null> {
    return this.avatarEffects.get(runtimeId) ?? null;
  }

  listSceneVFX() {
    return [];
  }

  resolveSceneVFX() {
    return null;
  }

  async loadSceneVFX() {
    return null;
  }

  listAudio() {
    return [];
  }

  async resolveAudio() {
    return null;
  }
}

/**
 * Plain-language notes on what a clip's events will not show in the preview:
 * effects with no resolved dependency, Scene Effects and sounds (drawn and
 * played by the chat scene), plus the media's own resolution notices.
 */
export function previewMediaNotices(
  clip: AnyAnimaPoseClip,
  media: PreviewMedia | null,
): string[] {
  const notices = new Set(media?.notices ?? []);
  const avatarAliases = new Set(
    media?.avatarEffects.map(({ alias }) => alias) ?? [],
  );
  const particleAliases = new Set(
    media?.particleEffects.map(({ alias }) => alias) ?? [],
  );
  const missing = (kind: string, alias: string) =>
    media
      ? `${kind} “${alias}” has no resolved dependency, so it does not play.`
      : `${kind} “${alias}” does not play: a clip file has no dependencies; preview the Library item or its project file.`;
  for (const event of clip.events ?? []) {
    if (event.kind === "avatar_vfx" && !avatarAliases.has(event.effectId))
      notices.add(missing("Avatar Effect", event.effectId));
    else if (
      event.kind === "particle_vfx" &&
      !particleAliases.has(event.effectId)
    )
      notices.add(missing("Particle Effect", event.effectId));
    else if (event.kind === "scene_vfx")
      notices.add(
        `Scene Effect “${event.presetId}” (${event.time.toFixed(2)} s) is not shown: the chat scene draws it.`,
      );
    else if (event.kind === "sfx")
      notices.add("Sounds are not played in the preview.");
  }
  return [...notices];
}

/** Whether a clip has events that need runtime media. */
export function clipUsesMedia(clip: AnyAnimaPoseClip): boolean {
  return (clip.events ?? []).some(
    ({ kind }) => kind === "avatar_vfx" || kind === "particle_vfx",
  );
}

function describeError(error: unknown): string {
  if (error instanceof AvatarEffectDefinitionError && error.field)
    return `${error.field}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
