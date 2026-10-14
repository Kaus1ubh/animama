import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
  RuntimeContentSlot,
} from "./types";
import { runtimeSourceHasFiles } from "./types";
import type { RuntimePreparationSession } from "./RuntimeMountPreparer";
import { createLogger } from "@/lib/logger";
import type { AnimaPoseClipAvatarVFXOverride } from "@/lib/avatar/poses/animaPoseClip";
import type {
  AvatarMotionCatalog,
  AvatarMotionClipDescriptor,
  AvatarMotionPreloadEntry,
  AvatarMotionPreloadTier,
  AvatarVrmaResource,
} from "@/lib/avatar/motion/AvatarMotionCatalog";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  evaluateManifestIdleEntries,
  normalizeFile,
  normalizeLoopType,
  selectManifestIdleCandidateFromEntries,
  type ManifestAnimation,
  type ManifestEmotionWeights,
  type ManifestGestureEntry,
  type ManifestIdleCandidateEvaluation,
  type ManifestIdleSelectionResult,
} from "@/lib/avatar/animationManifest";
import type {
  AnimaPose,
  ResolvedAnimaPose,
} from "@/lib/avatar/poses/animaPose";
import {
  MAX_ANIMA_POSE_CLIP_BYTES,
  parseAnimaPoseClip,
  validateAnimaPoseClipEventCatalogRefs,
  type AnimaPoseClipV2,
  type AnimaPoseClipEventCatalogRefDiagnostics,
} from "@/lib/avatar/poses/animaPoseClip";
import type { NormalizedEmotionReactionIntensity } from "@/lib/avatar/reactionClips";
import type { EmotionRuntimeState, TrackedEmotion } from "@/lib/emotion";
import {
  intensityFromEmotionValue,
  isTrackedEmotion,
  TRACKED_EMOTIONS,
} from "@/lib/emotion";
import {
  AnimaRuntimeMediaCatalog,
  type AnimaRuntimeMediaProvider,
  type ResolvedRuntimeAudio,
  type RuntimeAudioDescriptor,
} from "./AnimaRuntimeMediaCatalog";
import type {
  ParticleVFXCatalogEntry,
  ParticleVFXPreloadTier,
} from "@/lib/avatar/particle-vfx/types";
import type {
  AvatarVFXCatalogEntry,
  AvatarVFXParsedEntry,
} from "@/lib/avatar/vfx/types";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";
import {
  fetchPrivateRuntimeContentResponse,
  readBoundedJsonResponse,
  runtimeContentDeliveryUrl,
  runtimeContentDownloadUrl,
  preparedRuntimeResourceUrls,
} from "./runtimeContentDelivery";

const MAX_EAGER_PRELOAD_BYTES = 64 * 1024 * 1024;
const logger = createLogger("AnimaRuntimeCatalog");

type RuntimeCatalogFetch = typeof fetch;

type LazyClipSource = {
  entry: RuntimeCatalogEntry;
  url: string;
  sizeBytes: number;
};

export type AnimaRuntimeCatalogDiagnostic = {
  code:
    | "duplicate_runtime_id"
    | "invalid_motion_source"
    | "motion_resource_failed"
    | "invalid_motion_manifest"
    | "missing_event_reference"
    | "missing_effect_dependency"
    | "runtime_resource_pending"
    | "avatar_vfx_source_unsupported";
  slot: RuntimeContentSlot;
  runtimeId: string;
  message: string;
};

/**
 * Per-Anima motion inventory derived exclusively from one frozen runtime
 * response. User manifests stay lazy and private resource URLs stay logical.
 */
export class AnimaRuntimeCatalog
  implements AvatarMotionCatalog, AnimaRuntimeMediaProvider
{
  readonly revision: string;
  readonly diagnostics: AnimaRuntimeCatalogDiagnostic[] = [];

  private readonly fetcher: RuntimeCatalogFetch;
  private readonly allowMissingClipEventReferences: boolean;
  private readonly mediaCatalog: AnimaRuntimeMediaCatalog;
  private readonly admittedEntries = new Map<string, RuntimeCatalogEntry>();
  private readonly issuedRoots = new Map<string, readonly string[]>();
  private readonly pendingWarnings = new Set<string>();
  private readonly unsupportedAvatarVFX = new Set<string>();
  private readonly getRootReadiness?: RuntimePreparationSession["getRootReadiness"];
  private readonly listeners = new Set<() => void>();
  private availabilityVersion = 0;
  private readonly preparing: () => boolean;
  private lastPreparing: boolean;
  private readonly idleAnimations: ManifestAnimation[] = [];
  private idleCellPools: AnimaRuntimeCatalogSnapshot["idle_style_pools"];
  private readonly idleStylePools = new Map<
    string,
    { isDefault: boolean; emotions: Set<string> }
  >();
  private readonly gestures = new Map<string, ManifestGestureEntry>();
  private readonly poseClipDescriptors = new Map<
    string,
    AvatarMotionClipDescriptor
  >();
  private readonly reactionClipDescriptors = new Map<
    string,
    AvatarMotionClipDescriptor
  >();
  private readonly poseClips = new Map<string, AnimaPoseClipV2>();
  private readonly reactionClips = new Map<string, AnimaPoseClipV2>();
  private readonly lazyPoseClips = new Map<string, LazyClipSource>();
  private readonly lazyReactionClips = new Map<string, LazyClipSource>();
  private readonly poseClipSources = new Map<string, RuntimeCatalogEntry>();
  private readonly rejectedPoseRuntimeIds = new Set<string>();
  private readonly pendingPoseClips = new Map<
    string,
    Promise<AnimaPoseClipV2 | null>
  >();
  private readonly pendingReactionClips = new Map<
    string,
    Promise<AnimaPoseClipV2 | null>
  >();
  private readonly vrmaResources = new Map<string, AvatarVrmaResource>();
  private readonly vrmaCache: NonNullable<AvatarVrmaResource["cache"]> =
    new Map();
  private readonly preloadEntries: AvatarMotionPreloadEntry[] = [];
  private eagerPreloadRemainingBytes = MAX_EAGER_PRELOAD_BYTES;
  private readonly abortControllers = new Set<AbortController>();
  private readonly effectiveEventIds: {
    avatarVFXIds: Set<string>;
    sceneBackgroundLayerPresetIds: Set<string>;
    sceneFocusLinePresetIds: Set<string>;
    particleVFXIds: Set<string>;
    sfxCueIds: Set<string>;
  };
  private disposed = false;

  constructor(
    runtime: AnimaRuntimeCatalogSnapshot,
    options: {
      fetcher?: RuntimeCatalogFetch;
      /** Isolated Library previews have no Anima loadout to supply effects. */
      allowMissingClipEventReferences?: boolean;
      /** Identities only; unprepared sources are never registered with a player. */
      preparation?: {
        issued: AnimaRuntimeCatalogSnapshot;
        getRootReadiness: RuntimePreparationSession["getRootReadiness"];
        isPreparing: () => boolean;
      };
    } = {},
  ) {
    this.revision = runtime.effective_revision;
    this.fetcher = options.fetcher ?? fetch;
    this.allowMissingClipEventReferences =
      options.allowMissingClipEventReferences ?? false;
    this.getRootReadiness = options.preparation?.getRootReadiness;
    this.preparing = options.preparation?.isPreparing ?? (() => false);
    this.lastPreparing = this.preparing();
    if (options.preparation) {
      for (const entries of [
        options.preparation.issued.idle_animations,
        options.preparation.issued.gestures,
        options.preparation.issued.poses,
        options.preparation.issued.reactions,
        options.preparation.issued.particle_vfx,
        options.preparation.issued.avatar_vfx,
        options.preparation.issued.scene_background_vfx,
        options.preparation.issued.scene_focus_vfx,
        options.preparation.issued.sfx,
      ]) {
        for (const entry of entries)
          this.issuedRoots.set(
            this.entryKey(entry),
            entry.runtime_root_ids ?? [],
          );
      }
    }
    this.effectiveEventIds = {
      avatarVFXIds: new Set(
        runtime.avatar_vfx.map((entry) => entry.runtime_id),
      ),
      sceneBackgroundLayerPresetIds: new Set(
        runtime.scene_background_vfx.map((entry) => entry.runtime_id),
      ),
      sceneFocusLinePresetIds: new Set(
        runtime.scene_focus_vfx.map((entry) => entry.runtime_id),
      ),
      particleVFXIds: new Set(
        runtime.particle_vfx.map((entry) => entry.runtime_id),
      ),
      sfxCueIds: new Set(runtime.sfx.map((entry) => entry.runtime_id)),
    };

    this.addMotion(runtime);
    this.recordUnsupportedAvatarVFX(runtime.avatar_vfx);
    this.mediaCatalog = new AnimaRuntimeMediaCatalog(
      this.mediaEntries(runtime),
      {
        fetcher: this.fetcher,
        reserveEagerPreloadBytes: (bytes) => this.reservePreloadBytes(bytes),
      },
    );
  }

  /** Observe resource admission without changing the catalog's identity or revision. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getAvailabilityVersion = (): number => this.availabilityVersion;
  isPreparing = (): boolean => this.preparing();

  /** Append only ready resources from the existing mount, never a new server revision. */
  admitPrepared(runtime: AnimaRuntimeCatalogSnapshot): void {
    if (this.disposed) return;
    if (runtime.effective_revision !== this.revision)
      throw new Error(
        "Runtime revision replacement requires an explicit remount.",
      );
    for (const entries of Object.values(this.mediaEntries(runtime)).concat([
      runtime.idle_animations,
      runtime.gestures,
      runtime.poses,
      runtime.reactions,
    ])) {
      for (const entry of entries) {
        if (
          entry.source.type === "authorized_files" &&
          entry.source.files.length
        ) {
          throw new Error(
            "Only verified prepared resources may enter a progressive runtime.",
          );
        }
      }
    }
    // Event references are admitted in the same synchronous operation as their
    // root, before the motion manifest can be decoded or validated.
    for (const entry of runtime.avatar_vfx)
      this.effectiveEventIds.avatarVFXIds.add(entry.runtime_id);
    for (const entry of runtime.scene_background_vfx)
      this.effectiveEventIds.sceneBackgroundLayerPresetIds.add(
        entry.runtime_id,
      );
    for (const entry of runtime.scene_focus_vfx)
      this.effectiveEventIds.sceneFocusLinePresetIds.add(entry.runtime_id);
    for (const entry of runtime.particle_vfx)
      this.effectiveEventIds.particleVFXIds.add(entry.runtime_id);
    for (const entry of runtime.sfx)
      this.effectiveEventIds.sfxCueIds.add(entry.runtime_id);
    const previousCount = this.admittedEntries.size;
    this.addMotion(runtime);
    this.recordUnsupportedAvatarVFX(runtime.avatar_vfx);
    const mediaChanged = this.mediaCatalog.admitPrepared(
      this.mediaEntries(runtime),
    );
    const preparing = this.preparing();
    if (
      !mediaChanged &&
      previousCount === this.admittedEntries.size &&
      this.lastPreparing === preparing
    )
      return;
    this.lastPreparing = preparing;
    this.availabilityVersion++;
    for (const listener of this.listeners) listener();
  }

  private mediaEntries(runtime: AnimaRuntimeCatalogSnapshot) {
    return {
      particleVfx: runtime.particle_vfx,
      avatarVfx: runtime.avatar_vfx,
      sceneBackgroundVfx: runtime.scene_background_vfx,
      sceneFocusVfx: runtime.scene_focus_vfx,
      sfx: runtime.sfx,
    };
  }

  private entryKey(
    entry: Pick<RuntimeCatalogEntry, "slot" | "runtime_id">,
  ): string {
    return `${entry.slot}:${normalizeFile(entry.runtime_id)}`;
  }

  /** Remember admission attempts too, so malformed roots cannot churn on each update. */
  private newEntries(
    entries: readonly RuntimeCatalogEntry[],
  ): RuntimeCatalogEntry[] {
    return uniqueEntries(entries, (duplicate) =>
      this.recordDuplicate(duplicate),
    ).filter((entry) => {
      const key = this.entryKey(entry);
      const previous = this.admittedEntries.get(key);
      if (previous) {
        if (previous.content_revision !== entry.content_revision)
          throw new Error("Runtime content changed within an issued revision.");
        return false;
      }
      this.admittedEntries.set(key, entry);
      return true;
    });
  }

  private reservePreloadBytes(bytes: number): boolean {
    if (bytes > this.eagerPreloadRemainingBytes) return false;
    this.eagerPreloadRemainingBytes -= bytes;
    return true;
  }

  private addMotion(runtime: AnimaRuntimeCatalogSnapshot): void {
    if (runtime.idle_style_pools) this.idleCellPools = runtime.idle_style_pools;
    for (const entry of this.newEntries(runtime.idle_animations)) {
      const animation =
        entry.kind === "anima_pose_clip"
          ? this.createIdlePoseClip(entry)
          : this.createVrmaAnimation(entry, "idle_animation");
      if (animation) {
        this.idleAnimations.push(animation);
        if (
          "idle_style_default" in entry.config ||
          "idle_style_emotions" in entry.config
        ) {
          this.idleStylePools.set(animation.id ?? entry.runtime_id, {
            isDefault: entry.config.idle_style_default === true,
            emotions: new Set(
              Array.isArray(entry.config.idle_style_emotions)
                ? entry.config.idle_style_emotions.map(String)
                : [],
            ),
          });
        }
      }
    }
    for (const entry of this.newEntries(runtime.gestures)) {
      this.addGesture(entry);
    }
    for (const entry of this.newEntries(runtime.poses)) {
      this.addPoseClip(entry, "pose");
    }
    for (const entry of this.newEntries(runtime.reactions)) {
      this.addPoseClip(entry, "reaction");
    }
  }

  /** Pending requests are skipped, not queued; diagnostics are once per resource and capped. */
  private pending(slot: RuntimeContentSlot, runtimeId: string): boolean {
    const key = this.entryKey({ slot, runtime_id: runtimeId });
    const roots = this.issuedRoots.get(key) ?? [];
    if (!roots.some((id) => this.getRootReadiness?.(id) === "pending"))
      return false;
    if (roots.some((id) => this.getRootReadiness?.(id) === "ready"))
      return false;
    if (this.pendingWarnings.size < 32 && !this.pendingWarnings.has(key)) {
      this.pendingWarnings.add(key);
      this.diagnostics.push({
        code: "runtime_resource_pending",
        slot,
        runtimeId,
        message: "Playback was skipped while this resource was preparing.",
      });
      logger.info("Preparation", "Skipped playback of a pending resource", {
        slot,
        reason: "runtime_resource_pending",
      });
    }
    return true;
  }

  isGesturePending(runtimeId: string): boolean {
    return this.pending("gesture", runtimeId);
  }

  getIdleAnimations(): readonly ManifestAnimation[] {
    return this.idleAnimations;
  }

  evaluateIdleAnimations(
    emotionalState: EmotionRuntimeState,
  ): ManifestIdleCandidateEvaluation {
    return evaluateManifestIdleEntries(
      this.idlePool(emotionalState),
      emotionalState,
    );
  }

  selectIdleAnimation(args: {
    emotionalState: EmotionRuntimeState;
    randomRoll: number;
    previousFile?: string | null;
  }): ManifestIdleSelectionResult {
    return selectManifestIdleCandidateFromEntries({
      entries: this.idlePool(args.emotionalState),
      ...args,
    });
  }

  /** Select the configured dominant-emotion pool before existing weighted selection. */
  private idlePool(emotionalState: EmotionRuntimeState): ManifestAnimation[] {
    if (!this.idleCellPools && !this.idleStylePools.size)
      return this.idleAnimations;
    let dominant: TrackedEmotion | null = null;
    let dominantValue = 0;
    for (const emotion of TRACKED_EMOTIONS) {
      const value = emotionalState.values[emotion] ?? 0;
      if (value > dominantValue) {
        dominant = emotion;
        dominantValue = value;
      }
    }
    if (this.idleCellPools) {
      const cell = dominant
        ? this.idleCellPools.cells[dominant]?.[
            String(intensityFromEmotionValue(dominantValue))
          ]
        : undefined;
      const ids = new Set(cell ?? this.idleCellPools.default);
      return uniformIdlePool(
        this.idleAnimations.filter((entry) => ids.has(entry.id ?? "")),
      );
    }
    const mapped = dominant
      ? this.idleAnimations.filter((entry) =>
          this.idleStylePools.get(entry.id ?? "")?.emotions.has(dominant!),
        )
      : [];
    if (mapped.length) return uniformIdlePool(mapped);
    return uniformIdlePool(
      this.idleAnimations.filter(
        (entry) => this.idleStylePools.get(entry.id ?? "")?.isDefault,
      ),
    );
  }

  getGesture(
    runtimeId: string | null | undefined,
  ): ManifestGestureEntry | null {
    const normalized = normalizeFile(runtimeId ?? "");
    if (!normalized) return null;
    if (this.pending("gesture", normalized)) return null;
    return this.gestures.get(normalized) ?? null;
  }

  listAnimations(): readonly ManifestAnimation[] {
    return [
      ...this.idleAnimations,
      ...Array.from(this.gestures.values(), (gesture) => gesture.entry),
    ];
  }

  getPoseClip(runtimeId: string): AnimaPoseClipV2 | null {
    return this.poseClips.get(normalizeFile(runtimeId)) ?? null;
  }

  loadPoseClip(runtimeId: string): Promise<AnimaPoseClipV2 | null> {
    if (
      this.pending("pose", runtimeId) ||
      this.pending("gesture", runtimeId) ||
      this.pending("idle_animation", runtimeId)
    )
      return Promise.resolve(null);
    return this.loadClip(
      normalizeFile(runtimeId),
      "pose",
      this.poseClips,
      this.lazyPoseClips,
      this.pendingPoseClips,
    );
  }

  listPoseClips(): readonly AvatarMotionClipDescriptor[] {
    return Array.from(this.poseClipDescriptors.values()).map((entry) => ({
      ...entry,
      loaded: this.poseClips.has(entry.runtimeId),
    }));
  }

  getReactionClip(runtimeId: string): AnimaPoseClipV2 | null {
    return this.reactionClips.get(normalizeFile(runtimeId)) ?? null;
  }

  loadReactionClip(runtimeId: string): Promise<AnimaPoseClipV2 | null> {
    if (this.pending("reaction", runtimeId)) return Promise.resolve(null);
    return this.loadClip(
      normalizeFile(runtimeId),
      "reaction",
      this.reactionClips,
      this.lazyReactionClips,
      this.pendingReactionClips,
    );
  }

  listReactionClips(): readonly AvatarMotionClipDescriptor[] {
    return Array.from(this.reactionClipDescriptors.values()).map((entry) => ({
      ...entry,
      loaded: this.reactionClips.has(entry.runtimeId),
    }));
  }

  getReactionRuntimeId(args: {
    emotionalTone: string | null | undefined;
    emotionalIntensity: NormalizedEmotionReactionIntensity;
  }): string | null {
    if (args.emotionalIntensity === 0) return null;
    const tone = args.emotionalTone?.trim() ?? "";
    if (!isTrackedEmotion(tone)) return null;
    const runtimeId = `${tone}-${args.emotionalIntensity}`;
    if (this.pending("reaction", runtimeId)) return null;
    return this.reactionClipDescriptors.has(runtimeId) ? runtimeId : null;
  }

  getPoseIds(): readonly string[] {
    return BUILT_IN_AVATAR_MOTION_CATALOG.getPoseIds();
  }

  getDefaultPoseIds(): readonly string[] {
    return BUILT_IN_AVATAR_MOTION_CATALOG.getDefaultPoseIds();
  }

  getPose(poseId: string): AnimaPose {
    return BUILT_IN_AVATAR_MOTION_CATALOG.getPose(poseId);
  }

  getResolvedPose(poseId: string): ResolvedAnimaPose {
    return BUILT_IN_AVATAR_MOTION_CATALOG.getResolvedPose(poseId);
  }

  getPreloadEntries(): readonly AvatarMotionPreloadEntry[] {
    return this.preloadEntries;
  }

  resolveVrma(file: string): AvatarVrmaResource | null {
    return this.vrmaResources.get(file) ?? null;
  }

  listParticleVFX(): readonly ParticleVFXCatalogEntry[] {
    return this.mediaCatalog.listParticleVFX();
  }

  getParticlePreloadIds(tier: ParticleVFXPreloadTier): readonly string[] {
    return this.mediaCatalog.getParticlePreloadIds(tier);
  }

  resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null> {
    if (this.pending("particle_vfx", runtimeId)) return Promise.resolve(null);
    return this.mediaCatalog.resolveParticleVFX(runtimeId);
  }

  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null {
    return this.mediaCatalog.resolveAvatarVFX(runtimeId);
  }

  loadAvatarVFX(
    runtimeId: string,
    override?: AnimaPoseClipAvatarVFXOverride,
  ): Promise<AvatarVFXParsedEntry | null> {
    if (this.pending("avatar_vfx", runtimeId)) return Promise.resolve(null);
    return this.mediaCatalog.loadAvatarVFX(runtimeId, override);
  }

  listAvatarVFX(): readonly AvatarVFXCatalogEntry[] {
    return this.mediaCatalog.listAvatarVFX();
  }

  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[] {
    return this.mediaCatalog.listSceneVFX(kind);
  }

  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null {
    return this.mediaCatalog.resolveSceneVFX(kind, runtimeId);
  }

  loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null> {
    if (
      this.pending(
        kind === "focus_lines" ? "scene_focus_vfx" : "scene_background_vfx",
        runtimeId,
      )
    )
      return Promise.resolve(null);
    return this.mediaCatalog.loadSceneVFX(kind, runtimeId);
  }

  listAudio(kind: "sfx"): readonly RuntimeAudioDescriptor[] {
    return this.mediaCatalog.listAudio(kind);
  }

  resolveAudio(
    kind: "sfx",
    runtimeId: string,
  ): Promise<ResolvedRuntimeAudio | null> {
    if (this.pending(kind, runtimeId)) return Promise.resolve(null);
    return this.mediaCatalog.resolveAudio(kind, runtimeId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.admittedEntries.clear();
    this.issuedRoots.clear();
    this.mediaCatalog.dispose();
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
    this.pendingPoseClips.clear();
    this.pendingReactionClips.clear();
    this.idleAnimations.length = 0;
    this.gestures.clear();
    this.poseClipDescriptors.clear();
    this.reactionClipDescriptors.clear();
    this.poseClips.clear();
    this.reactionClips.clear();
    this.lazyPoseClips.clear();
    this.lazyReactionClips.clear();
    this.poseClipSources.clear();
    this.rejectedPoseRuntimeIds.clear();
    this.vrmaResources.clear();
    this.vrmaCache.clear();
    this.preloadEntries.length = 0;
  }

  private addGesture(entry: RuntimeCatalogEntry): void {
    const runtimeId = normalizeFile(entry.runtime_id);
    if (!runtimeId) return;
    if (entry.kind === "animation") {
      const animation = this.createVrmaAnimation(entry, "gesture");
      if (!animation) return;
      this.gestures.set(runtimeId, {
        id: runtimeId,
        name: animation.name,
        description: animation.description ?? "",
        type: "vrma",
        file: animation.file,
        duration: animation.duration,
        loopType: normalizeLoopType(animation.loop_type),
        loopCount: positiveInteger(animation.loop_count),
        timeScale: positiveNumber(animation.time_scale) ?? 1,
        entry: animation,
      });
      return;
    }
    if (entry.kind !== "anima_pose_clip") {
      this.recordInvalid(entry, "Gesture source is not playable motion");
      return;
    }
    if (!this.addPoseClip(entry, "gesture")) return;
    this.gestures.set(runtimeId, {
      id: runtimeId,
      name: entry.display_name,
      description: entry.description ?? "",
      type: "animaPoseClip",
      file: runtimeId,
      duration: positiveNumber(entry.config.duration_seconds),
      loopType: entry.config.loop === true ? "repeat" : "once",
      loopCount: positiveInteger(entry.config.loop_count),
      timeScale: positiveNumber(entry.config.time_scale) ?? 1,
      entry: {
        id: runtimeId,
        name: entry.display_name,
        file: runtimeId,
        type: "animaPoseClip",
        description: entry.description ?? undefined,
        emotions: parseEmotionWeights(entry.config.emotion_weights),
        animation_type: "gesture",
        duration: positiveNumber(entry.config.duration_seconds),
        loop_type: entry.config.loop === true ? "repeat" : "once",
        loop_count: positiveInteger(entry.config.loop_count),
        time_scale: positiveNumber(entry.config.time_scale),
        weight: numberValue(entry.config.weight),
      },
    });
  }

  /** Idle membership exposes a playable clip without adding an AI-callable Gesture. */
  private createIdlePoseClip(
    entry: RuntimeCatalogEntry,
  ): ManifestAnimation | null {
    if (!this.addPoseClip(entry, "idle_animation")) return null;
    return {
      id: entry.runtime_id,
      name: entry.display_name,
      file: entry.runtime_id,
      type: "animaPoseClip",
      animation_type: "idle",
      emotions: {},
      idle_playback: true,
      duration: positiveNumber(entry.config.duration_seconds),
      loop_type: normalizeLoopType(entry.config.loop_type),
      loop_count: positiveInteger(entry.config.loop_count),
      time_scale: positiveNumber(entry.config.time_scale),
    };
  }

  private createVrmaAnimation(
    entry: RuntimeCatalogEntry,
    slot: "idle_animation" | "gesture",
  ): ManifestAnimation | null {
    if (entry.kind !== "animation") {
      this.recordInvalid(entry, "VRMA slot source is not an animation");
      return null;
    }
    const resource = this.createVrmaResource(entry);
    if (!resource) return null;
    const file = `runtime-vrma:${slot}:${entry.runtime_id}:${entry.content_revision}`;
    this.vrmaResources.set(file, resource);
    this.vrmaResources.set(resource.url, resource);
    let preloadTier = parsePreloadTier(entry.config.preload_tier, slot);
    if (preloadTier !== "none" && runtimeSourceHasFiles(entry.source)) {
      const bytes = entry.source.files.reduce(
        (total, file) => total + file.size_bytes,
        0,
      );
      if (bytes > this.eagerPreloadRemainingBytes) {
        preloadTier = "none";
        logger.warn(
          "Preload",
          "Runtime media preload budget rejected an entry",
          {
            slot,
            reason: "eager_preload_budget_exceeded",
          },
        );
      } else {
        this.eagerPreloadRemainingBytes -= bytes;
      }
    }
    this.preloadEntries.push({
      runtimeId: entry.runtime_id,
      clipName: entry.display_name,
      file,
      tier: preloadTier,
    });
    return {
      id: entry.runtime_id,
      name: entry.display_name,
      file,
      type: "vrma",
      description: entry.description ?? undefined,
      emotions: parseEmotionWeights(entry.config.emotion_weights),
      base_pose: stringValue(entry.config.base_pose),
      animation_type: slot === "idle_animation" ? "idle" : "gesture",
      idle_playback: !!entry.config.idle_playback,
      duration: positiveNumber(entry.config.duration_seconds),
      blend_mode: parseBlendMode(entry.config.blend_mode),
      loop_type: parseLoopType(entry.config.loop_type, slot),
      loop_count: positiveInteger(entry.config.loop_count),
      time_scale: positiveNumber(entry.config.time_scale),
      weight: numberValue(entry.config.weight),
    };
  }

  private createVrmaResource(
    entry: RuntimeCatalogEntry,
  ): AvatarVrmaResource | null {
    const url = runtimeContentDeliveryUrl(entry);
    if (!url) {
      this.recordInvalid(entry, "VRMA source has no resolvable file URL");
      return null;
    }
    return {
      runtimeId: entry.runtime_id,
      url,
      cacheKey: `vrma:${entry.runtime_id}:${entry.content_revision}`,
      cache: this.vrmaCache,
      resourceUrls: preparedRuntimeResourceUrls(entry),
      ...(entry.source.type === "authorized_files"
        ? {
            getDownloadUrl: async () => {
              if (this.disposed) {
                throw new DOMException(
                  "Runtime catalog disposed",
                  "AbortError",
                );
              }
              const controller = new AbortController();
              this.abortControllers.add(controller);
              try {
                const download = await runtimeContentDownloadUrl(entry, url, {
                  fetcher: this.fetcher,
                  signal: controller.signal,
                });
                if (!download) {
                  throw new Error("VRMA download URL is unavailable");
                }
                return {
                  url: download.url,
                  release: () => {
                    download.release();
                    this.abortControllers.delete(controller);
                  },
                };
              } catch (error) {
                this.abortControllers.delete(controller);
                throw error;
              }
            },
          }
        : {}),
    };
  }

  private addPoseClip(
    entry: RuntimeCatalogEntry,
    destination: "gesture" | "pose" | "reaction" | "idle_animation",
  ): boolean {
    if (entry.kind !== "anima_pose_clip") {
      this.recordInvalid(
        entry,
        "Pose/reaction source is not an anima pose clip",
      );
      return false;
    }
    const runtimeId = normalizeFile(entry.runtime_id);
    if (!runtimeId) return false;
    if (destination !== "reaction") {
      if (this.rejectedPoseRuntimeIds.has(runtimeId)) {
        this.recordDuplicate(entry);
        return false;
      }
      const existingSource = this.poseClipSources.get(runtimeId);
      if (
        existingSource &&
        existingSource.content_revision !== entry.content_revision
      ) {
        this.recordDuplicate(existingSource);
        this.recordDuplicate(entry);
        this.rejectedPoseRuntimeIds.add(runtimeId);
        this.poseClipSources.delete(runtimeId);
        this.poseClipDescriptors.delete(runtimeId);
        this.poseClips.delete(runtimeId);
        this.lazyPoseClips.delete(runtimeId);
        if (this.gestures.get(runtimeId)?.type === "animaPoseClip") {
          this.gestures.delete(runtimeId);
        }
        return false;
      }
      if (existingSource) return true;
    }
    const descriptors =
      destination === "reaction"
        ? this.reactionClipDescriptors
        : this.poseClipDescriptors;
    descriptors.set(runtimeId, {
      runtimeId,
      displayName: entry.display_name,
      description: entry.description,
      loaded: false,
    });

    if (entry.source.type === "runtime_catalog") {
      const clip = this.resolveBuiltInClip(entry);
      if (!clip) {
        this.recordInvalid(entry, "Built-in pose clip could not be resolved");
        descriptors.delete(runtimeId);
        return false;
      }
      const normalized = this.normalizeLoadedClip(entry, clip);
      if (!normalized) {
        descriptors.delete(runtimeId);
        return false;
      }
      if (destination === "reaction")
        this.reactionClips.set(runtimeId, normalized);
      else {
        this.poseClipSources.set(runtimeId, entry);
        this.poseClips.set(runtimeId, normalized);
      }
      return true;
    }

    if (!runtimeSourceHasFiles(entry.source)) {
      descriptors.delete(runtimeId);
      return false;
    }
    const source = entry.source;
    // Typed Gesture/Reaction releases own a `sequence` file. Keep accepting
    // `manifest` for older runtime projections while the player transition is
    // still additive.
    const sequence =
      source.files.find((file) => file.role === "sequence") ??
      source.files.find((file) => file.role === "manifest");
    const url = sequence
      ? runtimeContentDeliveryUrl({
          ...entry,
          source: { ...source, files: [sequence] },
        })
      : null;
    if (!sequence || !url || sequence.size_bytes > MAX_ANIMA_POSE_CLIP_BYTES) {
      this.recordInvalid(
        entry,
        "Private pose clip sequence is unavailable or oversized",
      );
      descriptors.delete(runtimeId);
      return false;
    }
    const lazy = {
      entry,
      url,
      sizeBytes: sequence.size_bytes,
    } satisfies LazyClipSource;
    if (destination === "reaction") this.lazyReactionClips.set(runtimeId, lazy);
    else {
      this.poseClipSources.set(runtimeId, entry);
      this.lazyPoseClips.set(runtimeId, lazy);
    }
    return true;
  }

  private resolveBuiltInClip(
    entry: RuntimeCatalogEntry,
  ): AnimaPoseClipV2 | null {
    if (entry.source.type !== "runtime_catalog") return null;
    if (entry.source.catalog === "avatar_pose_clips") {
      return BUILT_IN_AVATAR_MOTION_CATALOG.getPoseClip(entry.source.key);
    }
    if (entry.source.catalog === "avatar_reaction_clips") {
      return BUILT_IN_AVATAR_MOTION_CATALOG.getReactionClip(entry.source.key);
    }
    return null;
  }

  private loadClip(
    runtimeId: string,
    slot: "pose" | "reaction",
    loaded: Map<string, AnimaPoseClipV2>,
    lazy: Map<string, LazyClipSource>,
    pending: Map<string, Promise<AnimaPoseClipV2 | null>>,
  ): Promise<AnimaPoseClipV2 | null> {
    if (!runtimeId || this.disposed) return Promise.resolve(null);
    const existing = loaded.get(runtimeId);
    if (existing) return Promise.resolve(existing);
    const active = pending.get(runtimeId);
    if (active) return active;
    const source = lazy.get(runtimeId);
    if (!source) return Promise.resolve(null);

    const request = this.fetchClip(source)
      .then((clip) => {
        if (clip && !this.disposed) loaded.set(runtimeId, clip);
        return this.disposed ? null : clip;
      })
      .catch((error) => {
        this.diagnostics.push({
          code: "motion_resource_failed",
          slot: source.entry.slot,
          runtimeId,
          message: error instanceof Error ? error.message : String(error),
        });
        logger.warn("Load", "Failed to load private motion manifest", {
          slot,
          runtimeId,
          error,
        });
        return null;
      })
      .finally(() => pending.delete(runtimeId));
    pending.set(runtimeId, request);
    return request;
  }

  private async fetchClip(
    source: LazyClipSource,
  ): Promise<AnimaPoseClipV2 | null> {
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      if (this.disposed) return null;
      const response = await fetchPrivateRuntimeContentResponse(
        source.entry,
        source.url,
        {
          fetcher: this.fetcher,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Motion manifest fetch failed with HTTP ${response.status}`,
        );
      }
      let parsed: AnimaPoseClipV2;
      try {
        const payload = await readBoundedJsonResponse(
          response,
          MAX_ANIMA_POSE_CLIP_BYTES,
        );
        parsed = parseAnimaPoseClip(payload);
      } catch (error) {
        this.diagnostics.push({
          code: "invalid_motion_manifest",
          slot: source.entry.slot,
          runtimeId: source.entry.runtime_id,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
      return this.normalizeLoadedClip(source.entry, parsed);
    } catch (error) {
      if (controller.signal.aborted && this.disposed) return null;
      throw error;
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  private normalizeLoadedClip(
    entry: RuntimeCatalogEntry,
    clip: AnimaPoseClipV2,
  ): AnimaPoseClipV2 | null {
    const referenceMap =
      entry.config.runtime_reference_map &&
      typeof entry.config.runtime_reference_map === "object"
        ? (entry.config.runtime_reference_map as Record<string, unknown>)
        : {};
    // A Local Action outlives an Included effect removed before launch: its
    // events for that effect are skipped and the rest of the clip plays.
    const removed =
      entry.config.runtime_missing_references &&
      typeof entry.config.runtime_missing_references === "object"
        ? (entry.config.runtime_missing_references as Record<string, unknown>)
        : {};
    const skipped = new Set<string>();
    const playable = clip.events?.filter((event) => {
      const alias =
        event.kind === "scene_vfx"
          ? event.presetId
          : event.kind === "avatar_vfx" || event.kind === "particle_vfx"
            ? event.effectId
            : null;
      if (
        alias === null ||
        !Object.hasOwn(removed, alias) ||
        Object.hasOwn(referenceMap, alias)
      )
        return true;
      skipped.add(String(removed[alias]));
      return false;
    });
    if (skipped.size) {
      const message = `Playing without removed effects: ${[...skipped].join(", ")}`;
      this.diagnostics.push({
        code: "missing_effect_dependency",
        slot: entry.slot,
        runtimeId: entry.runtime_id,
        message,
      });
      logger.warn("Playback", message, { runtimeId: entry.runtime_id });
    }
    const events = playable?.map((event) => {
      if (event.kind === "sfx") {
        return {
          ...event,
          cueId: String(referenceMap[event.cueId] ?? event.cueId),
        };
      }
      if (event.kind === "scene_vfx") {
        return {
          ...event,
          presetId: String(referenceMap[event.presetId] ?? event.presetId),
        };
      }
      return {
        ...event,
        effectId: String(referenceMap[event.effectId] ?? event.effectId),
      };
    });
    const normalized = parseAnimaPoseClip({
      ...clip,
      id: normalizeFile(entry.runtime_id),
      name: entry.display_name,
      events,
    });
    // Older shipped manifests can still resolve their source keys through the
    // trusted in-app catalogs. Typed/private roots, and built-in roots carrying
    // a closure map, must resolve exclusively through this frozen runtime.
    if (
      runtimeSourceHasFiles(entry.source) ||
      Object.keys(referenceMap).length > 0
    ) {
      const missing = validateAnimaPoseClipEventCatalogRefs(
        normalized,
        this.effectiveEventIds,
      );
      if (hasMissingEventReferences(missing)) {
        this.diagnostics.push({
          code: "missing_event_reference",
          slot: entry.slot,
          runtimeId: entry.runtime_id,
          message:
            "Pose clip references a runtime ID outside this Anima catalog",
        });
        if (!this.allowMissingClipEventReferences) return null;
      }
    }
    return normalized;
  }

  /**
   * Avatar Effects play only from registered definition files. The bundled
   * fallback registry is retired, so a `runtime_catalog` source cannot resolve.
   */
  private recordUnsupportedAvatarVFX(
    entries: readonly RuntimeCatalogEntry[],
  ): void {
    for (const entry of entries) {
      if (entry.source.type !== "runtime_catalog") continue;
      const key = this.entryKey(entry);
      if (this.unsupportedAvatarVFX.has(key)) continue;
      this.unsupportedAvatarVFX.add(key);
      this.diagnostics.push({
        code: "avatar_vfx_source_unsupported",
        slot: entry.slot,
        runtimeId: entry.runtime_id,
        message: "Avatar Effect requires a registered definition file",
      });
    }
  }

  private recordDuplicate(entry: RuntimeCatalogEntry): void {
    this.diagnostics.push({
      code: "duplicate_runtime_id",
      slot: entry.slot,
      runtimeId: entry.runtime_id,
      message: "Ambiguous runtime ID was omitted",
    });
  }

  private recordInvalid(entry: RuntimeCatalogEntry, message: string): void {
    this.diagnostics.push({
      code: "invalid_motion_source",
      slot: entry.slot,
      runtimeId: entry.runtime_id,
      message,
    });
  }
}

function uniqueEntries(
  entries: readonly RuntimeCatalogEntry[],
  onDuplicate: (entry: RuntimeCatalogEntry) => void,
): RuntimeCatalogEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.runtime_id, (counts.get(entry.runtime_id) ?? 0) + 1);
  }
  return entries.filter((entry) => {
    if (counts.get(entry.runtime_id) === 1) return true;
    onDuplicate(entry);
    return false;
  });
}

/** A configured pool has already performed emotion eligibility selection. */
function uniformIdlePool(
  entries: readonly ManifestAnimation[],
): ManifestAnimation[] {
  return entries.map((entry) => ({ ...entry, emotions: {}, weight: 1 }));
}

function parseEmotionWeights(
  value: unknown,
): Partial<Record<TrackedEmotion, ManifestEmotionWeights>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<TrackedEmotion, ManifestEmotionWeights>> = {};
  for (const [emotion, raw] of Object.entries(value)) {
    if (!isTrackedEmotion(emotion) || !isRecord(raw)) continue;
    result[emotion] = {
      "1": numberValue(raw["1"]) ?? 0,
      "2": numberValue(raw["2"]) ?? 0,
      "3": numberValue(raw["3"]) ?? 0,
    };
  }
  return result;
}

function parsePreloadTier(
  value: unknown,
  slot: "idle_animation" | "gesture",
): AvatarMotionPreloadTier {
  if (value === "tier_a" || value === "tier_b" || value === "none") {
    return value;
  }
  return slot === "idle_animation" ? "tier_a" : "tier_b";
}

function parseLoopType(
  value: unknown,
  slot: "idle_animation" | "gesture",
): "once" | "repeat" | "pingpong" {
  if (value === "once" || value === "repeat" || value === "pingpong") {
    return value;
  }
  return slot === "idle_animation" ? "repeat" : "once";
}

function parseBlendMode(value: unknown): "normal" | "additive" | undefined {
  return value === "normal" || value === "additive" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = positiveNumber(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasMissingEventReferences(
  diagnostics: AnimaPoseClipEventCatalogRefDiagnostics,
): boolean {
  return Object.values(diagnostics).some((values) => values.length > 0);
}
