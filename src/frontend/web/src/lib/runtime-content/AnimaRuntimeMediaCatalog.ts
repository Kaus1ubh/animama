import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { runtimeSourceHasFiles } from "@/lib/runtime-content/types";
import { AVATAR_PARTICLE_VFX_CATALOG } from "@/lib/avatar/particle-vfx/catalog";
import { parseParticleVFXRuntimeConfig } from "@/lib/avatar/particle-vfx/runtimeConfig";
import type {
  ParticleVFXCatalogEntry,
  ParticleVFXPreloadTier,
} from "@/lib/avatar/particle-vfx/types";
import type { AnimaPoseClipAvatarVFXOverride } from "@/lib/avatar/poses/animaPoseClip";
import {
  AvatarEffectDefinitionError,
  parseAvatarEffectDefinition,
  parseAvatarEffectUse,
  validateAvatarEffectDefinition,
  type AvatarEffectEntryContext,
} from "@/lib/avatar/vfx/definition";
import {
  assertAvatarEffectImageWithinLimits,
  MAX_AVATAR_EFFECT_IMAGE_BYTES,
} from "@/lib/avatar/vfx/effect-image-limits";
import {
  isAttachmentVFXEntry,
  type AvatarVFXCatalogEntry,
  type AvatarVFXParsedEntry,
} from "@/lib/avatar/vfx/types";
import {
  getSceneBackgroundLayerPresetById,
  getSceneFocusLinePresetById,
} from "@/lib/scene-vfx/catalog";
import { sceneEntryFromDefinition } from "@/lib/scene-vfx/sceneDefinition";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";
import {
  PARTICLE_TEXTURE_LIMITS,
  SCENE_IMAGE_LIMITS,
  inspectEffectArt,
} from "@/lib/effects/effectArtLimits";
import { createLogger } from "@/lib/logger";
import {
  fetchPrivateRuntimeContentResponse,
  runtimeContentDeliveryUrl,
} from "./runtimeContentDelivery";

const MAX_PARTICLE_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_PARTICLE_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_SCENE_EFFECT_BYTES = 32 * 1024 * 1024;
const MAX_RESIDENT_PRIVATE_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_EAGER_PRELOAD_BYTES = 64 * 1024 * 1024;
const MAX_PRIVATE_FETCH_CONCURRENCY = 2;
const logger = createLogger("AnimaRuntimeMediaCatalog");

type RuntimeCatalogFetch = typeof fetch;

export type RuntimeAudioDescriptor = {
  runtimeId: string;
  label: string;
  kind: "sfx";
  volume: number;
  sizeBytes: number | null;
};

export type ResolvedRuntimeAudio = RuntimeAudioDescriptor & {
  url: string;
};

export interface AnimaRuntimeMediaProvider {
  /** Progressive catalogs notify admission without replacing existing audio/effects. */
  subscribe?: (listener: () => void) => () => void;
  getAvailabilityVersion?: () => number;
  isPreparing?: () => boolean;
  listParticleVFX(): readonly ParticleVFXCatalogEntry[];
  getParticlePreloadIds(tier: ParticleVFXPreloadTier): readonly string[];
  resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null>;
  listAvatarVFX(): readonly AvatarVFXCatalogEntry[];
  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null;
  /**
   * A deferred-attachment entry is returned so its consumer can report it.
   * With a clip event's `override`, the entry is that one use (ADR 0025);
   * null when the effect is unavailable or cannot play the override.
   */
  loadAvatarVFX(
    runtimeId: string,
    override?: AnimaPoseClipAvatarVFXOverride,
  ): Promise<AvatarVFXParsedEntry | null>;
  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[];
  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null;
  loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null>;
  listAudio(kind: "sfx"): readonly RuntimeAudioDescriptor[];
  resolveAudio(
    kind: "sfx",
    runtimeId: string,
  ): Promise<ResolvedRuntimeAudio | null>;
}

type PrivateResource = {
  entry: RuntimeCatalogEntry;
  url: string;
  expectedBytes: number;
  contentType: string;
};

type MediaEntries = {
  particleVfx: readonly RuntimeCatalogEntry[];
  avatarVfx: readonly RuntimeCatalogEntry[];
  sceneBackgroundVfx: readonly RuntimeCatalogEntry[];
  sceneFocusVfx: readonly RuntimeCatalogEntry[];
  sfx: readonly RuntimeCatalogEntry[];
};

type PrivateFetchPool = {
  active: number;
  waiters: Array<{
    resolve: () => void;
    reject: (reason: Error) => void;
  }>;
};

/**
 * Effect and audio projection for one immutable Anima runtime response.
 *
 * Static registries are reachable only through exact Built-in content identities in
 * the mounted response. Private resources are fetched through the application origin and
 * owned Blob URLs are revoked with the catalog.
 */
export class AnimaRuntimeMediaCatalog implements AnimaRuntimeMediaProvider {
  private readonly fetcher: RuntimeCatalogFetch;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private readonly reserveEagerPreloadBytes: (bytes: number) => boolean;
  private readonly allocatedParticlePreloads = new Set<string>();
  private readonly particleEntries = new Map<string, RuntimeCatalogEntry>();
  private readonly particleDescriptors = new Map<
    string,
    ParticleVFXCatalogEntry
  >();
  private readonly avatarVFXEntries = new Map<string, AvatarVFXParsedEntry>();
  private readonly sceneVFXEntries = new Map<string, SceneVFXEntry>();
  private readonly avatarVFXSources = new Map<string, RuntimeCatalogEntry>();
  /** Resolved images and sound of each loaded effect, for per-use overrides. */
  private readonly avatarVFXContexts = new Map<
    string,
    AvatarEffectEntryContext
  >();
  private readonly sceneVFXSources = new Map<string, RuntimeCatalogEntry>();
  private readonly audioEntries = new Map<string, RuntimeCatalogEntry>();
  private readonly audioDescriptors = new Map<string, RuntimeAudioDescriptor>();
  private readonly particlePreloadIds: Record<
    ParticleVFXPreloadTier,
    string[]
  > = {
    tierA: [],
    tierB: [],
    none: [],
  };
  private readonly pendingParticles = new Map<
    string,
    Promise<ParticleVFXCatalogEntry | null>
  >();
  private readonly pendingAudio = new Map<
    string,
    Promise<ResolvedRuntimeAudio | null>
  >();
  private readonly pendingAvatarVFX = new Map<
    string,
    Promise<AvatarVFXParsedEntry | null>
  >();
  private readonly pendingSceneVFX = new Map<
    string,
    Promise<SceneVFXEntry | null>
  >();
  private readonly resolvedParticles = new Map<
    string,
    ParticleVFXCatalogEntry
  >();
  private readonly resolvedAudio = new Map<string, ResolvedRuntimeAudio>();
  private readonly objectUrls = new Set<string>();
  private readonly abortControllers = new Set<AbortController>();
  private readonly fetchPools: Record<
    "particle" | "effect" | "audio",
    PrivateFetchPool
  > = {
    particle: { active: 0, waiters: [] },
    effect: { active: 0, waiters: [] },
    audio: { active: 0, waiters: [] },
  };
  private residentPrivateBytes = 0;
  private disposed = false;

  constructor(
    entries: MediaEntries,
    options: {
      fetcher?: RuntimeCatalogFetch;
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
      eagerPreloadBudgetBytes?: number;
      reserveEagerPreloadBytes?: (bytes: number) => boolean;
    } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.createObjectURL =
      options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectURL =
      options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
    let remainingPreloadBytes = Math.max(
      0,
      Math.min(
        MAX_EAGER_PRELOAD_BYTES,
        options.eagerPreloadBudgetBytes ?? MAX_EAGER_PRELOAD_BYTES,
      ),
    );
    this.reserveEagerPreloadBytes =
      options.reserveEagerPreloadBytes ??
      ((bytes) => {
        if (bytes > remainingPreloadBytes) return false;
        remainingPreloadBytes -= bytes;
        return true;
      });
    this.admitPrepared(entries);
  }

  /** Add newly verified entries; retained decoders, URLs and budgets are never reset. */
  admitPrepared(entries: MediaEntries): boolean {
    if (this.disposed) return false;
    let changed = false;
    for (const entry of uniqueRuntimeEntries(entries.particleVfx)) {
      if (this.particleEntries.has(entry.runtime_id)) continue;
      const descriptor = this.createParticleDescriptor(entry);
      if (!descriptor) continue;
      changed = true;
      this.particleEntries.set(entry.runtime_id, entry);
      this.particleDescriptors.set(entry.runtime_id, descriptor);
    }
    this.allocateParticlePreloads();
    for (const entry of uniqueRuntimeEntries(entries.avatarVfx)) {
      if (this.avatarVFXSources.has(entry.runtime_id)) continue;
      changed = true;
      // Avatar Effects resolve only from registered files; a `runtime_catalog`
      // source has no bundled registry and is reported by the runtime catalog.
      this.avatarVFXSources.set(entry.runtime_id, entry);
    }
    for (const entry of uniqueRuntimeEntries(entries.sceneBackgroundVfx)) {
      if (
        this.sceneVFXSources.has(
          sceneKey("background_layers", entry.runtime_id),
        )
      )
        continue;
      changed = true;
      this.sceneVFXSources.set(
        sceneKey("background_layers", entry.runtime_id),
        entry,
      );
      const effect = resolveAppSceneVFX(entry, "background_layers");
      if (effect)
        this.sceneVFXEntries.set(
          sceneKey("background_layers", entry.runtime_id),
          effect,
        );
    }
    for (const entry of uniqueRuntimeEntries(entries.sceneFocusVfx)) {
      if (this.sceneVFXSources.has(sceneKey("focus_lines", entry.runtime_id)))
        continue;
      changed = true;
      this.sceneVFXSources.set(
        sceneKey("focus_lines", entry.runtime_id),
        entry,
      );
      const effect = resolveAppSceneVFX(entry, "focus_lines");
      if (effect)
        this.sceneVFXEntries.set(
          sceneKey("focus_lines", entry.runtime_id),
          effect,
        );
    }
    for (const entry of uniqueRuntimeEntries(entries.sfx)) {
      const key = audioKey("sfx", entry.runtime_id);
      if (this.audioEntries.has(key)) continue;
      const descriptor = createAudioDescriptor(entry, "sfx");
      if (!descriptor || !audioSource(entry)) continue;
      changed = true;
      this.audioEntries.set(key, entry);
      this.audioDescriptors.set(key, descriptor);
    }
    return changed;
  }

  listParticleVFX(): readonly ParticleVFXCatalogEntry[] {
    return Array.from(this.particleDescriptors.values());
  }

  resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null> {
    if (this.disposed) return Promise.resolve(null);
    const entry = this.particleEntries.get(runtimeId);
    const descriptor = this.particleDescriptors.get(runtimeId);
    if (!entry || !descriptor) return Promise.resolve(null);
    if (entry.source.type === "public_url") return Promise.resolve(descriptor);
    const resolved = this.resolvedParticles.get(runtimeId);
    if (resolved) return Promise.resolve(resolved);
    const active = this.pendingParticles.get(runtimeId);
    if (active) return active;
    const pending = this.loadPrivateParticle(entry, descriptor)
      .then((value) => {
        if (value && !this.disposed)
          this.resolvedParticles.set(runtimeId, value);
        return value;
      })
      .catch((error) => {
        const reason = safeErrorCode(error);
        logger.warn(
          "Fetch",
          `Private particle VFX failed to resolve: ${reason}`,
          {
            slot: entry.slot,
            reason,
          },
        );
        return null;
      })
      .finally(() => this.pendingParticles.delete(runtimeId));
    this.pendingParticles.set(runtimeId, pending);
    return pending;
  }

  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null {
    const entry = this.avatarVFXEntries.get(runtimeId);
    return entry && !isAttachmentVFXEntry(entry) ? entry : null;
  }

  loadAvatarVFX(
    runtimeId: string,
    override?: AnimaPoseClipAvatarVFXOverride,
  ): Promise<AvatarVFXParsedEntry | null> {
    const effect = this.loadEffectAvatarVFX(runtimeId);
    if (!override) return effect;
    return effect.then((loaded) =>
      loaded ? this.avatarVFXUse(runtimeId, override) : null,
    );
  }

  /**
   * One use of a loaded effect with a clip event's override, parsed from the
   * effect's definition and resolved images and never cached under its id.
   * An override the effect cannot play skips the use.
   */
  private avatarVFXUse(
    runtimeId: string,
    override: AnimaPoseClipAvatarVFXOverride,
  ): AvatarVFXParsedEntry | null {
    const entry = this.avatarVFXSources.get(runtimeId);
    const context = this.avatarVFXContexts.get(runtimeId);
    if (!entry || !context) return null;
    const references = recordValue(entry.config.runtime_reference_map) ?? {};
    try {
      return parseAvatarEffectUse(
        entry.definition,
        override,
        context,
        (alias) =>
          Object.hasOwn(references, alias)
            ? String(references[alias])
            : undefined,
      );
    } catch (error) {
      logger.warn("Playback", "Avatar VFX override cannot play", {
        slot: entry.slot,
        field:
          error instanceof AvatarEffectDefinitionError ? error.field : null,
      });
      return null;
    }
  }

  private loadEffectAvatarVFX(
    runtimeId: string,
  ): Promise<AvatarVFXParsedEntry | null> {
    if (this.disposed) return Promise.resolve(null);
    const resolved = this.avatarVFXEntries.get(runtimeId);
    if (resolved) return Promise.resolve(resolved);
    const entry = this.avatarVFXSources.get(runtimeId);
    if (!entry || !runtimeSourceHasFiles(entry.source))
      return Promise.resolve(null);
    const active = this.pendingAvatarVFX.get(runtimeId);
    if (active) return active;
    const pending = this.loadPrivateAvatarVFX(entry)
      .then((effect) => {
        if (effect && !this.disposed)
          this.avatarVFXEntries.set(runtimeId, effect);
        return effect;
      })
      .catch((error) => {
        logger.warn("Fetch", "Private Avatar VFX failed to resolve", {
          slot: entry.slot,
          reason: safeErrorCode(error),
        });
        return null;
      })
      .finally(() => this.pendingAvatarVFX.delete(runtimeId));
    this.pendingAvatarVFX.set(runtimeId, pending);
    return pending;
  }

  listAvatarVFX(): readonly AvatarVFXCatalogEntry[] {
    return Array.from(this.avatarVFXEntries.values()).filter(
      (entry): entry is AvatarVFXCatalogEntry => !isAttachmentVFXEntry(entry),
    );
  }

  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[] {
    const prefix = `${kind}:`;
    return Array.from(this.sceneVFXEntries.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => entry);
  }

  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null {
    return this.sceneVFXEntries.get(sceneKey(kind, runtimeId)) ?? null;
  }

  loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null> {
    if (this.disposed) return Promise.resolve(null);
    const resolved = this.resolveSceneVFX(kind, runtimeId);
    if (resolved) return Promise.resolve(resolved);
    const key = sceneKey(kind, runtimeId);
    const entry = this.sceneVFXSources.get(key);
    if (!entry || !runtimeSourceHasFiles(entry.source))
      return Promise.resolve(null);
    const active = this.pendingSceneVFX.get(key);
    if (active) return active;
    const pending = this.loadPrivateSceneVFX(entry, kind)
      .then((effect) => {
        if (effect && !this.disposed) this.sceneVFXEntries.set(key, effect);
        return effect;
      })
      .catch((error) => {
        logger.warn("Fetch", "Private Scene VFX failed to resolve", {
          slot: entry.slot,
          reason: safeErrorCode(error),
        });
        return null;
      })
      .finally(() => this.pendingSceneVFX.delete(key));
    this.pendingSceneVFX.set(key, pending);
    return pending;
  }

  listAudio(kind: "sfx"): readonly RuntimeAudioDescriptor[] {
    return Array.from(this.audioDescriptors.entries())
      .filter(([key]) => key.startsWith(`${kind}:`))
      .map(([, value]) => value);
  }

  resolveAudio(
    kind: "sfx",
    runtimeId: string,
  ): Promise<ResolvedRuntimeAudio | null> {
    if (this.disposed) return Promise.resolve(null);
    const key = audioKey(kind, runtimeId);
    const entry = this.audioEntries.get(key);
    const descriptor = this.audioDescriptors.get(key);
    if (!entry || !descriptor) return Promise.resolve(null);
    const resolved = this.resolvedAudio.get(key);
    if (resolved) return Promise.resolve(resolved);
    const active = this.pendingAudio.get(key);
    if (active) return active;
    const pending = this.loadAudio(entry, descriptor)
      .then((value) => {
        if (value && !this.disposed) this.resolvedAudio.set(key, value);
        return value;
      })
      .catch((error) => {
        logger.warn("Fetch", "Private runtime audio failed to resolve", {
          slot: entry.slot,
          reason: safeErrorCode(error),
        });
        return null;
      })
      .finally(() => this.pendingAudio.delete(key));
    this.pendingAudio.set(key, pending);
    return pending;
  }

  /** Return preloadable particle IDs without crossing the per-mount byte budget. */
  getParticlePreloadIds(tier: ParticleVFXPreloadTier): readonly string[] {
    return this.particlePreloadIds[tier];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
    for (const pool of Object.values(this.fetchPools)) {
      for (const waiter of pool.waiters.splice(0)) {
        waiter.reject(new Error("catalog_disposed"));
      }
    }
    for (const url of this.objectUrls) this.revokeObjectURL(url);
    this.objectUrls.clear();
    this.pendingParticles.clear();
    this.pendingAudio.clear();
    this.pendingAvatarVFX.clear();
    this.pendingSceneVFX.clear();
    this.resolvedParticles.clear();
    this.resolvedAudio.clear();
    this.residentPrivateBytes = 0;
    logger.debug("Lifecycle", "Disposed mounted media catalog");
  }

  private createParticleDescriptor(
    entry: RuntimeCatalogEntry,
  ): ParticleVFXCatalogEntry | null {
    const config = entry.config;
    const appEffect = resolveBuiltinParticleVFX(entry);
    if (entry.source.type === "public_url" && !appEffect) return null;
    return {
      id: entry.runtime_id,
      label: entry.display_name,
      description: entry.description ?? "",
      assetPath: appEffect?.assetPath ?? "",
      ...parseParticleVFXRuntimeConfig(config, appEffect ?? undefined),
    };
  }

  private allocateParticlePreloads(): void {
    for (const tier of ["tierA", "tierB"] as const) {
      for (const [runtimeId, descriptor] of this.particleDescriptors) {
        if (descriptor.preloadTier !== tier) continue;
        if (this.allocatedParticlePreloads.has(runtimeId)) continue;
        this.allocatedParticlePreloads.add(runtimeId);
        const entry = this.particleEntries.get(runtimeId);
        const bytes =
          entry && runtimeSourceHasFiles(entry.source)
            ? entry.source.files.reduce(
                (total, file) => total + file.size_bytes,
                0,
              )
            : 0;
        if (!this.reserveEagerPreloadBytes(bytes)) {
          logger.warn(
            "Preload",
            "Runtime media preload budget rejected an entry",
            {
              slot: "particle_vfx",
              reason: "eager_preload_budget_exceeded",
            },
          );
          continue;
        }
        this.particlePreloadIds[tier].push(runtimeId);
      }
    }
  }

  private async loadPrivateParticle(
    entry: RuntimeCatalogEntry,
    descriptor: ParticleVFXCatalogEntry,
  ): Promise<ParticleVFXCatalogEntry | null> {
    if (!runtimeSourceHasFiles(entry.source)) return null;
    const source = entry.source;
    const logicalResourceUrls = source.logical_resource_urls ?? {};
    const manifest = source.files.find((file) => file.role === "manifest");
    if (!manifest || manifest.size_bytes > MAX_PARTICLE_MANIFEST_BYTES) {
      throw new Error("particle_manifest_limit");
    }
    const packageBytes = source.files.reduce(
      (total, file) => total + file.size_bytes,
      0,
    );
    if (packageBytes > MAX_PARTICLE_PACKAGE_BYTES) {
      throw new Error("particle_package_limit");
    }
    this.reservePrivateBytes(packageBytes);
    const createdUrls: string[] = [];
    try {
      const manifestBlob = await this.fetchPrivate(
        {
          entry,
          url: manifest.url,
          expectedBytes: manifest.size_bytes,
          contentType: manifest.content_type,
        },
        "particle",
      );
      const payload = JSON.parse(await manifestBlob.text()) as unknown;
      const document = recordValue(payload);
      const images = Array.isArray(document?.images) ? document.images : null;
      if (!document || !images) throw new Error("particle_manifest_invalid");
      const referenced = new Set<string>();
      const textureUrlsByResource = new Map<string, string>();
      let textureBytes = 0;
      for (const image of images) {
        const imageRecord = recordValue(image);
        if (!imageRecord || typeof imageRecord.url !== "string") {
          throw new Error("particle_resource_invalid");
        }
        const logicalName = imageRecord.url;
        const resourceUrl = logicalResourceUrls[logicalName];
        if (!resourceUrl) {
          throw new Error("particle_resource_invalid");
        }
        referenced.add(logicalName);
        const file = source.files.find(
          (candidate) => candidate.url === resourceUrl,
        );
        if (!file) throw new Error("particle_resource_invalid");
        let objectUrl = textureUrlsByResource.get(resourceUrl);
        if (!objectUrl) {
          const textureBlob = await this.fetchPrivate(
            {
              entry,
              url: resourceUrl,
              expectedBytes: file.size_bytes,
              contentType: file.content_type,
            },
            "particle",
          );
          // Check each texture's size and header before the browser decodes
          // it, as for Avatar Effect images.
          textureBytes += textureBlob.size;
          if (
            textureUrlsByResource.size >= PARTICLE_TEXTURE_LIMITS.count ||
            textureBytes > PARTICLE_TEXTURE_LIMITS.totalBytes ||
            !(await inspectEffectArt(textureBlob, PARTICLE_TEXTURE_LIMITS)).ok
          ) {
            throw new Error("particle_texture_limit");
          }
          objectUrl = this.ownedObjectUrl(textureBlob);
          textureUrlsByResource.set(resourceUrl, objectUrl);
          createdUrls.push(objectUrl);
        }
        imageRecord.url = objectUrl;
      }
      if (referenced.size !== Object.keys(logicalResourceUrls).length) {
        throw new Error("particle_resource_invalid");
      }
      const rewritten = new Blob([JSON.stringify(document)], {
        type: "application/json",
      });
      const manifestUrl = this.ownedObjectUrl(rewritten);
      createdUrls.push(manifestUrl);
      return { ...descriptor, assetPath: manifestUrl };
    } catch (error) {
      this.residentPrivateBytes = Math.max(
        0,
        this.residentPrivateBytes - packageBytes,
      );
      for (const url of createdUrls) {
        if (this.objectUrls.delete(url)) this.revokeObjectURL(url);
      }
      throw error;
    }
  }

  /**
   * Fetch an Avatar Effect's registered images and parse its `/2` definition.
   * Each image's size and header dimensions are checked before an object URL
   * is created, so the browser never decodes an over-budget image.
   */
  private async loadPrivateAvatarVFX(
    entry: RuntimeCatalogEntry,
  ): Promise<AvatarVFXParsedEntry | null> {
    if (!runtimeSourceHasFiles(entry.source)) return null;
    // The backend reports a stored `/1` (or otherwise unreadable) definition.
    if (entry.definition_error) throw new Error(entry.definition_error);
    let definition;
    try {
      definition = validateAvatarEffectDefinition(entry.definition);
    } catch (error) {
      throw new Error(
        error instanceof AvatarEffectDefinitionError
          ? error.code
          : "avatar_vfx_definition_invalid",
      );
    }
    const logicalResourceUrls = entry.source.logical_resource_urls ?? {};
    const logicalImages = [
      definition.art.image,
      ...(definition.art.otherEyeImage ? [definition.art.otherEyeImage] : []),
    ];
    if (
      new Set(logicalImages).size !== logicalImages.length ||
      Object.keys(logicalResourceUrls).length !== logicalImages.length
    ) {
      throw new Error("avatar_vfx_definition_invalid");
    }
    const source = entry.source;
    const imageFiles = logicalImages.map((logicalImage) => {
      const imageUrl = logicalResourceUrls[logicalImage];
      const imageFile = imageUrl
        ? source.files.find((file) => file.url === imageUrl)
        : null;
      if (
        !imageFile ||
        imageFile.role !== "image" ||
        imageFile.size_bytes > MAX_AVATAR_EFFECT_IMAGE_BYTES
      ) {
        throw new Error("avatar_vfx_resource_invalid");
      }
      return imageFile;
    });
    const reservedBytes = imageFiles.reduce(
      (total, file) => total + file.size_bytes,
      0,
    );
    this.reservePrivateBytes(reservedBytes);
    const createdUrls: string[] = [];
    try {
      const objectUrls: string[] = [];
      for (const imageFile of imageFiles) {
        const imageBlob = await this.fetchPrivate(
          {
            entry,
            url: imageFile.url,
            expectedBytes: imageFile.size_bytes,
            contentType: imageFile.content_type,
          },
          "effect",
        );
        await assertAvatarEffectImageWithinLimits(imageBlob);
        const objectUrl = this.ownedObjectUrl(imageBlob);
        createdUrls.push(objectUrl);
        objectUrls.push(objectUrl);
      }
      const soundAlias = definition.soundAlias ?? null;
      const references = recordValue(entry.config.runtime_reference_map) ?? {};
      const context: AvatarEffectEntryContext = {
        id: entry.runtime_id,
        label: entry.display_name,
        description: entry.description ?? entry.display_name,
        assetPath: objectUrls[0]!,
        ...(objectUrls[1] ? { otherEyeAssetPath: objectUrls[1] } : {}),
        ...(soundAlias
          ? {
              sound: {
                onApply: String(references[soundAlias] ?? soundAlias),
              },
            }
          : {}),
      };
      try {
        const parsed = parseAvatarEffectDefinition(definition, context);
        this.avatarVFXContexts.set(entry.runtime_id, context);
        return parsed;
      } catch (error) {
        throw new Error(
          error instanceof AvatarEffectDefinitionError
            ? error.code
            : "avatar_vfx_definition_invalid",
        );
      }
    } catch (error) {
      this.residentPrivateBytes = Math.max(
        0,
        this.residentPrivateBytes - reservedBytes,
      );
      for (const url of createdUrls) {
        if (this.objectUrls.delete(url)) this.revokeObjectURL(url);
      }
      throw error;
    }
  }

  private async loadPrivateSceneVFX(
    entry: RuntimeCatalogEntry,
    expectedKind: SceneVFXKind,
  ): Promise<SceneVFXEntry | null> {
    if (!runtimeSourceHasFiles(entry.source)) return null;
    const definition = recordValue(entry.definition);
    if (!definition || definition.kind !== expectedKind) {
      throw new Error("scene_vfx_definition_invalid");
    }
    const logicalResourceUrls = entry.source.logical_resource_urls ?? {};
    const packageBytes = entry.source.files.reduce(
      (total, file) => total + file.size_bytes,
      0,
    );
    if (packageBytes > MAX_SCENE_EFFECT_BYTES)
      throw new Error("scene_vfx_package_limit");
    // The shared Scene image limits, as Save and import apply them.
    if (Object.keys(logicalResourceUrls).length > SCENE_IMAGE_LIMITS.count)
      throw new Error("scene_vfx_image_limit");
    this.reservePrivateBytes(packageBytes);
    const createdUrls: string[] = [];
    try {
      const objectUrlByLogicalName = new Map<string, string>();
      for (const [logicalName, resourceUrl] of Object.entries(
        logicalResourceUrls,
      )) {
        const file = entry.source.files.find(
          (candidate) => candidate.url === resourceUrl,
        );
        if (!file || file.role !== "image")
          throw new Error("scene_vfx_resource_invalid");
        const blob = await this.fetchPrivate(
          {
            entry,
            url: file.url,
            expectedBytes: file.size_bytes,
            contentType: file.content_type,
          },
          "effect",
        );
        // Raster art is checked from its header before anything decodes it;
        // SVG art is checked for bytes (its content is validated at Save).
        if (
          blob.size > SCENE_IMAGE_LIMITS.bytes ||
          (file.content_type !== "image/svg+xml" &&
            !(await inspectEffectArt(blob, SCENE_IMAGE_LIMITS)).ok)
        )
          throw new Error("scene_vfx_image_limit");
        const objectUrl = this.ownedObjectUrl(blob);
        createdUrls.push(objectUrl);
        objectUrlByLogicalName.set(logicalName, objectUrl);
      }
      if (
        expectedKind !== "background_layers" &&
        (entry.source.files.length > 0 ||
          Object.keys(logicalResourceUrls).length > 0)
      ) {
        throw new Error("scene_vfx_resource_invalid");
      }
      const soundAlias =
        typeof definition.soundAlias === "string"
          ? definition.soundAlias
          : null;
      const references = recordValue(entry.config.runtime_reference_map) ?? {};
      const { entry: sceneEntry, referencedImages } = sceneEntryFromDefinition(
        definition,
        { id: entry.runtime_id, label: entry.display_name },
        (logicalName) => objectUrlByLogicalName.get(logicalName),
        soundAlias
          ? { sound: { onApply: String(references[soundAlias] ?? soundAlias) } }
          : {},
      );
      if (
        expectedKind === "background_layers" &&
        referencedImages.size !== Object.keys(logicalResourceUrls).length
      )
        throw new Error("scene_vfx_resource_invalid");
      return sceneEntry;
    } catch (error) {
      this.residentPrivateBytes = Math.max(
        0,
        this.residentPrivateBytes - packageBytes,
      );
      for (const url of createdUrls) {
        if (this.objectUrls.delete(url)) this.revokeObjectURL(url);
      }
      throw error;
    }
  }

  private async loadAudio(
    entry: RuntimeCatalogEntry,
    descriptor: RuntimeAudioDescriptor,
  ): Promise<ResolvedRuntimeAudio | null> {
    const source = audioSource(entry);
    if (!source) return null;
    if (source.kind === "public") return { ...descriptor, url: source.url };
    this.reservePrivateBytes(source.resource.expectedBytes);
    try {
      const blob = await this.fetchPrivate(source.resource, "audio");
      return { ...descriptor, url: this.ownedObjectUrl(blob) };
    } catch (error) {
      this.residentPrivateBytes = Math.max(
        0,
        this.residentPrivateBytes - source.resource.expectedBytes,
      );
      throw error;
    }
  }

  private reservePrivateBytes(bytes: number): void {
    if (
      bytes < 0 ||
      this.residentPrivateBytes + bytes > MAX_RESIDENT_PRIVATE_MEDIA_BYTES
    ) {
      throw new Error("private_media_budget_exceeded");
    }
    this.residentPrivateBytes += bytes;
  }

  private ownedObjectUrl(blob: Blob): string {
    if (this.disposed) throw new Error("catalog_disposed");
    const url = this.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  private async fetchPrivate(
    resource: PrivateResource,
    poolName: "particle" | "effect" | "audio",
  ): Promise<Blob> {
    await this.acquireFetchSlot(poolName);
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const response = await fetchPrivateRuntimeContentResponse(
        resource.entry,
        resource.url,
        {
          fetcher: this.fetcher,
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`http_${response.status}`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > resource.expectedBytes) {
        throw new Error("resource_size_mismatch");
      }
      const bytes = await readBoundedBody(response, resource.expectedBytes);
      if (bytes.byteLength !== resource.expectedBytes) {
        throw new Error("resource_size_mismatch");
      }
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new Blob([buffer], { type: resource.contentType });
    } finally {
      this.abortControllers.delete(controller);
      this.releaseFetchSlot(poolName);
    }
  }

  private acquireFetchSlot(
    poolName: "particle" | "effect" | "audio",
  ): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("catalog_disposed"));
    const pool = this.fetchPools[poolName];
    if (pool.active < MAX_PRIVATE_FETCH_CONCURRENCY) {
      pool.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      pool.waiters.push({
        resolve: () => {
          if (this.disposed) {
            reject(new Error("catalog_disposed"));
            return;
          }
          pool.active += 1;
          resolve();
        },
        reject,
      });
    });
  }

  private releaseFetchSlot(poolName: "particle" | "effect" | "audio"): void {
    const pool = this.fetchPools[poolName];
    pool.active = Math.max(0, pool.active - 1);
    if (this.disposed) return;
    pool.waiters.shift()?.resolve();
  }
}

export const EMPTY_RUNTIME_MEDIA_PROVIDER: AnimaRuntimeMediaProvider = {
  listParticleVFX: () => [],
  getParticlePreloadIds: () => [],
  resolveParticleVFX: async () => null,
  listAvatarVFX: () => [],
  resolveAvatarVFX: () => null,
  loadAvatarVFX: async () => null,
  listSceneVFX: () => [],
  resolveSceneVFX: () => null,
  loadSceneVFX: async () => null,
  listAudio: () => [],
  resolveAudio: async () => null,
};

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maximumBytes)
      throw new Error("resource_size_limit");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("resource_size_limit");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function resolveBuiltinParticleVFX(entry: RuntimeCatalogEntry) {
  if (entry.source.type !== "public_url") return null;
  const source = entry.source;
  return (
    AVATAR_PARTICLE_VFX_CATALOG.find(
      (effect) => effect.assetPath === source.url,
    ) ?? null
  );
}

function resolveAppSceneVFX(
  entry: RuntimeCatalogEntry,
  kind: SceneVFXKind,
): SceneVFXEntry | null {
  const catalog =
    kind === "background_layers"
      ? "scene_background_presets"
      : "scene_focus_presets";
  if (
    entry.source.type !== "runtime_catalog" ||
    entry.source.catalog !== catalog
  )
    return null;
  const preset =
    kind === "background_layers"
      ? getSceneBackgroundLayerPresetById(entry.source.key)
      : getSceneFocusLinePresetById(entry.source.key);
  if (!preset?.enabled) return null;
  const references = recordValue(entry.config.runtime_reference_map) ?? {};
  const onApply = preset.sound?.onApply;
  return {
    ...preset,
    id: entry.runtime_id,
    ...(onApply
      ? { sound: { onApply: String(references[onApply] ?? onApply) } }
      : {}),
    ...(positiveNumber(entry.config.duration_ms) !== null
      ? { durationMs: positiveNumber(entry.config.duration_ms) }
      : {}),
  } as SceneVFXEntry;
}

function createAudioDescriptor(
  entry: RuntimeCatalogEntry,
  kind: "sfx",
): RuntimeAudioDescriptor | null {
  if (entry.kind !== "audio") return null;
  const source = audioSource(entry);
  return {
    runtimeId: entry.runtime_id,
    label: entry.display_name,
    kind,
    volume: normalizedVolume(entry.config.volume),
    sizeBytes:
      source?.kind === "private" ? source.resource.expectedBytes : null,
  };
}

function audioSource(
  entry: RuntimeCatalogEntry,
):
  | { kind: "public"; url: string }
  | { kind: "private"; resource: PrivateResource }
  | null {
  if (entry.source.type === "public_url")
    return { kind: "public", url: entry.source.url };
  if (entry.source.type === "runtime_catalog") return null;
  const file = entry.source.files.find(
    (candidate) => candidate.role === "audio",
  );
  const url = file
    ? runtimeContentDeliveryUrl({
        ...entry,
        source: { ...entry.source, files: [file] },
      })
    : null;
  return file && url
    ? {
        kind: "private",
        resource: {
          entry,
          url,
          expectedBytes: file.size_bytes,
          contentType: file.content_type,
        },
      }
    : null;
}

function uniqueRuntimeEntries(
  entries: readonly RuntimeCatalogEntry[],
): RuntimeCatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.runtime_id)) return false;
    seen.add(entry.runtime_id);
    return true;
  });
}

function sceneKey(kind: SceneVFXKind, runtimeId: string): string {
  return `${kind}:${runtimeId}`;
}

function audioKey(kind: "sfx", runtimeId: string): string {
  return `${kind}:${runtimeId}`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizedVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 1;
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (/^[a-z0-9_]+$/.test(message)) return message;
  if (message === "Runtime content download URL is unavailable") {
    return "runtime_download_unavailable";
  }
  if (error instanceof SyntaxError) return "particle_manifest_json_invalid";
  return "runtime_resource_failed";
}
