import type {
  AnimaPoseClipAvatarVFXOverride,
  AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip";
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
import { sceneEntryFromDefinition } from "@/lib/scene-vfx/sceneDefinition";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";

/**
 * Effects for the motion preview page (`scripts/animation-preview`) and the
 * review tools (`scripts/effect-render`). The server resolves an effect
 * source, or the typed dependencies of a Gesture or Reaction, from Included
 * and Local content and serves their files; this module turns them into the
 * runtime media provider an `Avatar` and the page's Scene layers play clip
 * events through, keyed by dependency alias as in chat.
 */

/** A Particle Effect: its served manifest and runtime config. */
export type PreviewParticleEffect = {
  alias: string;
  name: string;
  description: string;
  /** Served manifest; its relative texture URLs resolve beside it. */
  manifestUrl: string;
  /** The effect's stored runtime defaults overlaid with the dependency config. */
  config: Record<string, unknown>;
};

/** A Scene Effect: its stored definition and its images' served URLs. */
export type PreviewSceneEffect = {
  alias: string;
  name: string;
  /** The `animama/scene-effect/1` definition. */
  definition: Record<string, unknown>;
  /** Served URL of each image, by the logical name items use. */
  imageUrls: Record<string, string>;
};

/** An effect source reviewed on its own, of any kind. */
export type PreviewEffect = (
  | ({ kind: "avatar_effect" } & EffectSource)
  | ({ kind: "particle_effect" } & PreviewParticleEffect)
  | ({ kind: "scene_effect" } & PreviewSceneEffect)
) & {
  /** Seconds the effect stays applied (`--duration`), or null to loop. */
  duration: number | null;
};

/** The runtime entry a Scene Effect's layers draw, identified by its alias. */
export function previewSceneEntry(scene: PreviewSceneEffect): SceneVFXEntry {
  return sceneEntryFromDefinition(
    scene.definition,
    { id: scene.alias, label: scene.name },
    (logicalName) => scene.imageUrls[logicalName],
  ).entry;
}

/** What a clip's effect events can play, resolved from its dependencies. */
export type PreviewMedia = {
  avatarEffects: { alias: string; effect: EffectSource }[];
  particleEffects: PreviewParticleEffect[];
  sceneEffects: PreviewSceneEffect[];
  /** Dependencies that could not be resolved, with the reason. */
  notices: string[];
};

export const EMPTY_PREVIEW_MEDIA: PreviewMedia = {
  avatarEffects: [],
  particleEffects: [],
  sceneEffects: [],
  notices: [],
};

/**
 * Runtime media for one preview `Avatar` and its Scene layers. Avatar,
 * Particle and Scene Effects resolve by alias (the page draws Scene Effects,
 * as the chat scene does, by looking them up here); sounds are never played.
 * `setMedia` swaps the contents when the playing source changes, since an
 * `Avatar` keeps the provider it was created with.
 */
export class PreviewMediaProvider implements AnimaRuntimeMediaProvider {
  private avatarEffects = new Map<string, AvatarVFXParsedEntry>();
  private avatarEffectSources = new Map<string, EffectSource>();
  private particleEffects = new Map<string, ParticleVFXCatalogEntry>();
  private sceneEffects = new Map<string, SceneVFXEntry>();
  private problems: string[] = [];

  constructor(media: PreviewMedia = EMPTY_PREVIEW_MEDIA) {
    this.setMedia(media);
  }

  /** Replace the playable effects. Invalid definitions become `problems`. */
  setMedia(media: PreviewMedia): void {
    this.avatarEffects = new Map();
    this.avatarEffectSources = new Map();
    this.particleEffects = new Map();
    this.sceneEffects = new Map();
    this.problems = [];
    for (const { alias, effect } of media.avatarEffects) {
      try {
        this.avatarEffects.set(alias, effectSourceEntry(effect, alias));
        this.avatarEffectSources.set(alias, effect);
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
    for (const scene of media.sceneEffects) {
      try {
        this.sceneEffects.set(scene.alias, previewSceneEntry(scene));
      } catch (error) {
        this.problems.push(
          `Scene Effect “${scene.alias}” (${scene.name}): ${describeError(error)}`,
        );
      }
    }
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

  /** With a clip event's override, the one use; null when it cannot play. */
  async loadAvatarVFX(
    runtimeId: string,
    override?: AnimaPoseClipAvatarVFXOverride,
  ): Promise<AvatarVFXParsedEntry | null> {
    const effect = this.avatarEffectSources.get(runtimeId);
    if (!override || !effect) return this.avatarEffects.get(runtimeId) ?? null;
    try {
      return effectSourceEntry(effect, runtimeId, override);
    } catch (error) {
      // The review tools report problems; the clip plays on without this use.
      const problem = `Avatar Effect “${runtimeId}” (${effect.name}) override: ${describeError(error)}`;
      if (!this.problems.includes(problem)) this.problems.push(problem);
      return null;
    }
  }

  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[] {
    return [...this.sceneEffects.values()].filter(
      (entry) => entry.kind === kind,
    );
  }

  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null {
    const entry = this.sceneEffects.get(runtimeId);
    return entry?.kind === kind ? entry : null;
  }

  async loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null> {
    return this.resolveSceneVFX(kind, runtimeId);
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
 * effects with no resolved dependency and sounds, plus the media's own
 * resolution notices.
 */
export function previewMediaNotices(
  clip: AnimaPoseClipV2,
  media: PreviewMedia | null,
): string[] {
  const notices = new Set(media?.notices ?? []);
  const avatarAliases = new Set(
    media?.avatarEffects.map(({ alias }) => alias) ?? [],
  );
  const particleAliases = new Set(
    media?.particleEffects.map(({ alias }) => alias) ?? [],
  );
  const sceneAliases = new Set(
    media?.sceneEffects.map(({ alias }) => alias) ?? [],
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
    else if (event.kind === "scene_vfx" && !sceneAliases.has(event.presetId))
      notices.add(missing("Scene Effect", event.presetId));
    else if (event.kind === "sfx")
      notices.add("Sounds are not played in the preview.");
  }
  return [...notices];
}

/** Whether a clip has events that need runtime media. */
export function clipUsesMedia(clip: AnimaPoseClipV2): boolean {
  return (clip.events ?? []).some(
    ({ kind }) =>
      kind === "avatar_vfx" || kind === "particle_vfx" || kind === "scene_vfx",
  );
}

function describeError(error: unknown): string {
  if (error instanceof AvatarEffectDefinitionError && error.field)
    return `${error.field}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
