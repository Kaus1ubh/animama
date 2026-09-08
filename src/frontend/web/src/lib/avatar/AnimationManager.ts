import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation";
import type {
  AnimationLoopType,
  AnimationBlendMode,
  AnimationOptions,
  ActiveAnimationInfo,
} from "./types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AnimationManager");

type PlayOptions = AnimationOptions & { clipName?: string };
type VRMCoreLike = Parameters<typeof createVRMAnimationClip>[1];
type HumanoidPoseReset = {
  resetNormalizedPose?: () => void;
  resetRawPose?: () => void;
  resetPose?: () => void;
};
type ActionMeta = {
  blendMode: AnimationBlendMode;
  additiveReference: string | null;
  onFinished: (() => void) | null;
};

/**
 * AnimationManager handles skeletal animation playback for a VRM avatar.
 *
 * Responsibilities:
 * - Owns the THREE.AnimationMixer
 * - Loads VRMA animation files
 * - Crossfades between clips
 * - Provides update(delta) for the render loop
 */
export class AnimationManager {
  private _vrm: VRM;
  private _mixer: THREE.AnimationMixer;
  private _currentAction: THREE.AnimationAction | null = null;
  private _activeActions: Map<string, THREE.AnimationAction> = new Map();
  private _fadeStopTimers: Map<
    THREE.AnimationAction,
    ReturnType<typeof setTimeout>
  > = new Map();
  private _actionMeta: Map<string, ActionMeta> = new Map();
  private _clipCache: Map<string, THREE.AnimationClip> = new Map();
  private _defaultClip: THREE.AnimationClip | null = null;
  private _loadVrma: (url: string) => Promise<VRMAnimation | null>;
  private _rootedPlaybackEnabled = true;
  private _disposed = false;

  constructor(
    vrm: VRM,
    deps?: { loadVrma?: (url: string) => Promise<VRMAnimation | null> },
  ) {
    this._vrm = vrm;
    this._mixer = new THREE.AnimationMixer(vrm.scene);
    this._mixer.addEventListener("finished", this._handleMixerFinished);
    this._loadVrma = deps?.loadVrma ?? (async () => null);
  }

  /**
   * Load a VRMA file by URL and set it as the default animation.
   */
  async loadDefaultAnimation(
    url: string,
    options?: AnimationOptions,
  ): Promise<void> {
    void options;
    const clipName = AnimationManager._inferNameFromUrl(url);
    const clip = await this._loadClip(url, clipName);
    this._assertActive();
    this._defaultClip = clip;
  }

  /**
   * Play the stored default animation.
   */
  playDefaultAnimation(options?: AnimationOptions): void {
    if (!this._defaultClip) return;
    this._playClip(this._defaultClip, options);
  }

  /**
   * Play a VRMA animation by URL.
   */
  async playAnimation(url: string, options?: PlayOptions): Promise<void> {
    const clipName =
      options?.clipName ?? AnimationManager._inferNameFromUrl(url);
    const additiveReference =
      options?.blendMode === "additive"
        ? (options?.additiveReference ?? null)
        : null;
    const clip = await this._loadClip(url, clipName, additiveReference);
    this._playClip(clip, options);
  }

  /**
   * Load a VRMA animation clip without playing it.
   */
  async loadClip(
    url: string,
    options?: { clipName?: string; additiveReference?: string | null },
  ): Promise<THREE.AnimationClip> {
    const clipName =
      options?.clipName ?? AnimationManager._inferNameFromUrl(url);
    const additiveReference = options?.additiveReference ?? null;
    return this._loadClip(url, clipName, additiveReference);
  }

  /**
   * Load a VRMA animation clip and return its duration.
   */
  async getClipDuration(
    url: string,
    options?: { clipName?: string; additiveReference?: string | null },
  ): Promise<number> {
    const clip = await this.loadClip(url, options);
    return clip.duration ?? 0;
  }

  /**
   * Play a VRMA animation by URL with a custom clip name.
   */
  async playAnimationWithName(
    url: string,
    clipName: string,
    options?: AnimationOptions & { startTimeSec?: number },
  ): Promise<THREE.AnimationAction> {
    const additiveReference =
      options?.blendMode === "additive"
        ? (options?.additiveReference ?? null)
        : null;
    const clip = await this._loadClip(url, clipName, additiveReference);
    const action = this._playClip(clip, options);
    if (
      typeof options?.startTimeSec === "number" &&
      options.startTimeSec >= 0
    ) {
      action.time = options.startTimeSec;
    }
    return action;
  }

  /**
   * Play a looping state animation with a standardized crossfade.
   */
  async playLoop(
    url: string,
    clipName: string,
    options?: AnimationOptions,
  ): Promise<THREE.AnimationAction> {
    return this.playAnimationWithName(url, clipName, {
      ...options,
      loopType: options?.loopType ?? "repeat",
      fadeDuration: options?.fadeDuration ?? 2,
      warp: options?.warp ?? false,
      keepExisting: false,
    });
  }

  /**
   * Play a one-shot gesture that overrides the current loop.
   */
  async playGesture(
    url: string,
    clipName: string,
    options?: AnimationOptions,
  ): Promise<THREE.AnimationAction> {
    return this.playAnimationWithName(url, clipName, {
      ...options,
      loopType: "once",
      fadeDuration: options?.fadeDuration ?? 2,
      warp: options?.warp ?? false,
      keepExisting: false,
    });
  }

  /**
   * Update the animation mixer. Called from Avatar.update().
   */
  update(delta: number): void {
    if (this._disposed) return;
    this._mixer.update(delta);
  }

  /**
   * List currently tracked active animation actions.
   */
  getActiveActions(): THREE.AnimationAction[] {
    return Array.from(this._activeActions.values());
  }

  /**
   * List currently tracked active animation clip info.
   */
  getActiveActionInfo(): ActiveAnimationInfo[] {
    const items = Array.from(this._activeActions.entries()).map(
      ([name, action]) => ({
        name,
        isCurrent: this._currentAction === action,
        loopType: loopTypeFromAction(action),
        weight: clampWeight(action.getEffectiveWeight()),
        blendMode:
          this._actionMeta.get(name)?.blendMode ?? blendModeFromAction(action),
        timeScale: clampTimeScale(action.getEffectiveTimeScale()),
        additiveReference:
          this._actionMeta.get(name)?.additiveReference ?? null,
        clipDurationSec: getClipLocalDurationSec(action),
        playheadSec: getActionPlayheadSec(action),
        durationSec: getActionDurationSec(action),
      }),
    );
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List currently tracked active animation clip names.
   */
  getActiveActionNames(): string[] {
    return Array.from(this._activeActions.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  /**
   * Check whether generated VRMA clips discard humanoid translation tracks.
   */
  isRootedPlaybackEnabled(): boolean {
    return this._rootedPlaybackEnabled;
  }

  /**
   * Toggle rooted VRMA playback. Cached clips are mode-specific, so changing
   * this clears existing generated clips while leaving raw VRMA loads cached by
   * Avatar.
   */
  setRootedPlaybackEnabled(enabled: boolean): void {
    if (this._rootedPlaybackEnabled === enabled) return;
    this._rootedPlaybackEnabled = enabled;
    this._defaultClip = null;
    this._clipCache.clear();
  }

  /**
   * Stop a tracked animation by name.
   */
  stopAction(name: string): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    this._clearFadeStopTimer(action);
    action.stop();
    this._activeActions.delete(name);
    this._actionMeta.delete(name);
    if (this._currentAction === action) {
      this._currentAction = null;
    }
    return true;
  }

  /**
   * Update loop type for a tracked animation.
   */
  setActionLoopType(name: string, loopType: AnimationLoopType): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    const loop = resolveLoopType(loopType);
    const repetitions = resolveRepetitions(loopType);
    action.setLoop(loop, repetitions);
    action.clampWhenFinished = loopType === "once";
    return true;
  }

  /**
   * Update weight for a tracked animation.
   */
  setActionWeight(name: string, weight: number): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    const clamped = clampWeight(weight);
    action.setEffectiveWeight(clamped);
    return true;
  }

  /**
   * Update blend mode for a tracked animation.
   */
  setActionBlendMode(name: string, blendMode: AnimationBlendMode): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    if (blendMode === "additive") {
      action.blendMode = THREE.AdditiveAnimationBlendMode;
    } else {
      action.blendMode = THREE.NormalAnimationBlendMode;
    }
    const meta = this._actionMeta.get(name);
    if (meta) {
      meta.blendMode = blendMode;
      if (blendMode !== "additive") {
        meta.additiveReference = null;
      }
    } else {
      this._actionMeta.set(name, {
        blendMode,
        additiveReference: blendMode === "additive" ? null : null,
        onFinished: null,
      });
    }
    return true;
  }

  /**
   * Update time scale for a tracked animation.
   */
  setActionTimeScale(name: string, timeScale: number): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    action.setEffectiveTimeScale(clampTimeScale(timeScale));
    return true;
  }

  /**
   * Fade out a tracked animation by name.
   */
  fadeOutAction(name: string, fadeDuration: number): boolean {
    const action = this._activeActions.get(name);
    if (!action) return false;
    const duration = Math.max(0, fadeDuration);
    if (duration === 0) {
      this.stopAction(name);
      return true;
    }
    action.fadeOut(duration);
    this._scheduleStop(action, duration);
    return true;
  }

  /**
   * Stop all animations and dispose resources.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._mixer.stopAllAction();
    this._mixer.uncacheRoot(this._vrm.scene);
    this._mixer.removeEventListener("finished", this._handleMixerFinished);
    this._currentAction = null;
    this._defaultClip = null;
    this._activeActions.clear();
    this._actionMeta.clear();
    this._clipCache.clear();
    this._clearFadeStopTimers();
  }

  /**
   * Reset active animations and restore the VRM pose.
   */
  resetAll(): void {
    this._mixer.stopAllAction();
    this._activeActions.clear();
    this._actionMeta.clear();
    this._currentAction = null;
    this._clearFadeStopTimers();

    const humanoid = (this._vrm as unknown as { humanoid?: HumanoidPoseReset })
      ?.humanoid;
    if (humanoid) {
      if (typeof humanoid.resetNormalizedPose === "function") {
        humanoid.resetNormalizedPose();
      } else if (typeof humanoid.resetRawPose === "function") {
        humanoid.resetRawPose();
      } else if (typeof humanoid.resetPose === "function") {
        humanoid.resetPose();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** A finished decode must not repopulate or animate an already disposed rig. */
  private _assertActive(): void {
    if (this._disposed)
      throw new DOMException("Animation manager disposed.", "AbortError");
  }

  private _playClip(
    clip: THREE.AnimationClip,
    options?: AnimationOptions,
  ): THREE.AnimationAction {
    this._assertActive();
    if (options?.isCurrent?.() === false)
      throw new DOMException(
        "Animation request is no longer current.",
        "AbortError",
      );
    const action = this._mixer.clipAction(clip);
    // Reused clip actions can still have a pending fade-stop timer from a prior
    // crossfade. If not cleared, that stale timer can stop the action mid-play.
    this._clearFadeStopTimer(action);
    const actionKey = this._getActionKey(action);
    const keepExisting = options?.keepExisting ?? false;
    const blendMode = options?.blendMode ?? "normal";
    action.reset();
    action.enabled = true;
    if (blendMode === "additive") {
      action.blendMode = THREE.AdditiveAnimationBlendMode;
    } else {
      action.blendMode = THREE.NormalAnimationBlendMode;
    }
    action.setEffectiveWeight(clampWeight(options?.weight ?? 1));
    const loopType = options?.loopType ?? "repeat";
    const loop = resolveLoopType(loopType);
    const repetitions = resolveRepetitions(loopType, options?.loopCount);
    action.setLoop(loop, repetitions);
    action.clampWhenFinished = loopType === "once";
    const timeScale =
      typeof options?.timeScale === "number"
        ? clampTimeScale(options.timeScale)
        : 1;
    action.setEffectiveTimeScale(timeScale);

    const hasFadeDuration = typeof options?.fadeDuration === "number";
    const fadeDuration = options?.fadeDuration ?? 1.25;
    const warp = options?.warp ?? false;

    if (this._currentAction && this._currentAction !== action) {
      const previousAction = this._currentAction;
      if (keepExisting) {
        action.play();
        if (fadeDuration > 0) {
          action.fadeIn(fadeDuration);
        }
      } else {
        this._stopOtherActions(action, previousAction);
        action.play();
        if (fadeDuration > 0) {
          previousAction.crossFadeTo(action, fadeDuration, warp);
          this._scheduleStop(previousAction, fadeDuration);
          // action.setEffectiveTimeScale(timeScale);
        } else {
          previousAction.stop();
          this._activeActions.delete(this._getActionKey(previousAction));
        }
      }
      logger.info("Play Clip", "Playing new animation", {
        previousActionName: previousAction.getClip().name,
        newActionName: action.getClip().name,
        keepExisting: keepExisting,
        fadeDuration: fadeDuration,
        warp: warp,
        clipDuration: clip.duration,
        timeScale: timeScale,
        actionTimeScale: action.timeScale,
        repetitions: repetitions,
        loopType: loopType,
      });
    } else {
      if (!keepExisting) {
        this._stopOtherActions(action, null);
      }
      action.play();
      if (hasFadeDuration && fadeDuration > 0) {
        action.fadeIn(fadeDuration);
      }
      logger.info("Play Clip", "Playing new animation", {
        newActionName: action.getClip().name,
        keepExisting: keepExisting,
        fadeDuration: fadeDuration,
        warp: warp,
        clipDuration: clip.duration,
        timeScale: timeScale,
        repetitions: repetitions,
        loopType: loopType,
      });
    }

    this._activeActions.set(actionKey, action);
    this._actionMeta.set(actionKey, {
      blendMode,
      additiveReference:
        blendMode === "additive" ? (options?.additiveReference ?? null) : null,
      onFinished: options?.onFinished ?? null,
    });
    this._currentAction = action;
    return action;
  }

  private async _loadClip(
    vrmaOrUrl: VRMAnimation | string,
    clipName: string,
    additiveReference?: string | null,
  ): Promise<THREE.AnimationClip> {
    this._assertActive();
    const rootedPlaybackEnabled = this._rootedPlaybackEnabled;
    const cacheKey =
      typeof vrmaOrUrl === "string"
        ? this._getClipCacheKey(
            vrmaOrUrl,
            clipName,
            additiveReference,
            rootedPlaybackEnabled,
          )
        : null;
    if (cacheKey) {
      const cached = this._clipCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    const vrmAnimation =
      typeof vrmaOrUrl === "string"
        ? await this._loadVrma(vrmaOrUrl)
        : vrmaOrUrl;
    this._assertActive();

    if (!vrmAnimation) {
      throw new Error(`Failed to load VRMA animation: ${clipName}`);
    }

    // createVRMAnimationClip expects a VRMCore; @pixiv/three-vrm's VRM is compatible.
    let clip = createVRMAnimationClip(
      vrmAnimation,
      this._vrm as unknown as VRMCoreLike,
    );
    // The upstream helper names clips "Clip". Override so our UI can distinguish animations.
    clip.name = clipName;
    if (rootedPlaybackEnabled) {
      clip = stripTranslationTracksForRootedPlayback(clip);
    }

    if (!additiveReference) {
      if (cacheKey) {
        this._clipCache.set(cacheKey, clip);
      }
      return clip;
    }

    const referenceUrl = this._resolveAnimationUrl(additiveReference);
    const referenceAnimation = await this._loadVrma(referenceUrl);
    this._assertActive();
    if (!referenceAnimation) {
      throw new Error(
        `Failed to load additive reference VRMA: ${additiveReference}`,
      );
    }

    const referenceClip = createVRMAnimationClip(
      referenceAnimation,
      this._vrm as unknown as VRMCoreLike,
    );

    try {
      const additiveClip = clip.clone();
      THREE.AnimationUtils.makeClipAdditive(additiveClip, 0, referenceClip);
      additiveClip.name = clipName;
      if (cacheKey) {
        this._clipCache.set(cacheKey, additiveClip);
      }
      return additiveClip;
    } catch {
      if (cacheKey) {
        this._clipCache.set(cacheKey, clip);
      }
      return clip;
    }
  }

  private static _inferNameFromUrl(url: string): string {
    const withoutQuery = url.split("?")[0] ?? url;
    const parts = withoutQuery.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? url;
  }

  private _getActionKey(action: THREE.AnimationAction): string {
    const clip = action.getClip();
    return clip.name || clip.uuid;
  }

  private _stopOtherActions(
    nextAction: THREE.AnimationAction,
    preservedAction: THREE.AnimationAction | null,
  ): void {
    for (const [key, existing] of this._activeActions.entries()) {
      if (existing === nextAction || existing === preservedAction) continue;
      this._clearFadeStopTimer(existing);
      existing.stop();
      this._activeActions.delete(key);
      this._actionMeta.delete(key);
    }
  }

  private _scheduleStop(action: THREE.AnimationAction, delaySec: number): void {
    const existingTimer = this._fadeStopTimers.get(action);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this._fadeStopTimers.delete(action);
    }
    const timeout = setTimeout(
      () => {
        this._fadeStopTimers.delete(action);
        action.stop();
        const key = this._getActionKey(action);
        this._activeActions.delete(key);
        this._actionMeta.delete(key);
        if (this._currentAction === action) {
          this._currentAction = null;
        }
      },
      Math.max(0, delaySec * 1000),
    );
    this._fadeStopTimers.set(action, timeout);
  }

  private _clearFadeStopTimer(action: THREE.AnimationAction): void {
    const existingTimer = this._fadeStopTimers.get(action);
    if (!existingTimer) return;
    clearTimeout(existingTimer);
    this._fadeStopTimers.delete(action);
  }

  private _clearFadeStopTimers(): void {
    for (const timer of this._fadeStopTimers.values()) {
      clearTimeout(timer);
    }
    this._fadeStopTimers.clear();
  }

  private _handleMixerFinished = (event: THREE.Event): void => {
    const mixerEvent = event as THREE.Event & {
      action?: THREE.AnimationAction;
    };
    const action = mixerEvent.action;
    if (!action) return;
    const key = this._getActionKey(action);
    const onFinished = this._actionMeta.get(key)?.onFinished ?? null;
    this._activeActions.delete(key);
    this._actionMeta.delete(key);
    this._clearFadeStopTimer(action);
    if (this._currentAction === action) {
      this._currentAction = null;
    }
    onFinished?.();
    action.stop();
  };

  private _resolveAnimationUrl(value: string): string {
    if (value.startsWith("/")) return value;
    return `/vrm/animations/${value}`;
  }

  private _getClipCacheKey(
    url: string,
    clipName: string,
    additiveReference?: string | null,
    rootedPlaybackEnabled: boolean = this._rootedPlaybackEnabled,
  ): string {
    const resolvedUrl = this._resolveAnimationUrl(url);
    const resolvedReference = additiveReference
      ? this._resolveAnimationUrl(additiveReference)
      : "";
    return `${clipName}::${resolvedUrl}::${resolvedReference}::rooted:${rootedPlaybackEnabled}`;
  }
}

export function stripTranslationTracksForRootedPlayback(
  clip: THREE.AnimationClip,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => !isTranslationTrack(track));
  if (tracks.length === clip.tracks.length) {
    return clip;
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function isTranslationTrack(track: THREE.KeyframeTrack): boolean {
  return track.name.endsWith(".position");
}

function clampTimeScale(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0.05, Math.min(4, value));
}

function resolveLoopType(
  loopType: AnimationLoopType,
): THREE.AnimationActionLoopStyles {
  switch (loopType) {
    case "once":
      return THREE.LoopOnce;
    case "pingpong":
      return THREE.LoopPingPong;
    case "repeat":
    default:
      return THREE.LoopRepeat;
  }
}

function resolveRepetitions(
  loopType: AnimationLoopType,
  loopCount?: number,
): number {
  if (loopCount === -1) return Infinity;
  const normalizedCount =
    typeof loopCount === "number" && loopCount > 0
      ? Math.floor(loopCount)
      : null;
  switch (loopType) {
    case "once":
      return 1;
    case "pingpong":
      return normalizedCount ?? 2;
    case "repeat":
    default:
      return normalizedCount ?? Infinity;
  }
}

function loopTypeFromAction(action: THREE.AnimationAction): AnimationLoopType {
  switch (action.loop) {
    case THREE.LoopOnce:
      return "once";
    case THREE.LoopPingPong:
      return "pingpong";
    case THREE.LoopRepeat:
    default:
      return "repeat";
  }
}

function clampWeight(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function blendModeFromAction(
  action: THREE.AnimationAction,
): AnimationBlendMode {
  if (action.blendMode === THREE.AdditiveAnimationBlendMode) {
    return "additive";
  }
  return "normal";
}

function getActionDurationSec(action: THREE.AnimationAction): number {
  const clipDuration = action.getClip()?.duration ?? 0;
  const timeScale = clampTimeScale(action.getEffectiveTimeScale());
  const loop = action.loop;
  const repetitions =
    loop === THREE.LoopOnce ? 1 : (action.repetitions ?? Infinity);

  if (!Number.isFinite(repetitions) || repetitions === Infinity) {
    return -1;
  }

  if (repetitions <= 0 || clipDuration <= 0) {
    return 0;
  }

  const duration = (clipDuration * repetitions) / timeScale;
  return Number.isFinite(duration) ? duration : -1;
}

function getClipLocalDurationSec(action: THREE.AnimationAction): number {
  const clipDuration = action.getClip()?.duration ?? 0;
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) {
    return 0;
  }
  return clipDuration;
}

function getActionPlayheadSec(action: THREE.AnimationAction): number {
  const time = action.time;
  if (!Number.isFinite(time) || time < 0) {
    return 0;
  }
  return time;
}
