import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";

import {
  BUILT_IN_AVATAR_MOTION_CATALOG,
  type AvatarMotionCatalog,
} from "../motion/AvatarMotionCatalog";
import {
  applyAnimaPoseToVrm,
  cloneAnimaPose,
  cloneVRMPose,
  cloneVRMPoseTransform,
  getAnimaPoseExpressionNames,
  getAnimaPoseHumanoidBoneNames,
  isVRMHumanBoneName,
  resolveAnimaPose,
  sanitizeAnimaPose,
  type AnimaPose,
  type AnimaPoseApplyResult,
  type ResolvedAnimaPose,
} from "./animaPose";
import {
  collectAnimaPoseClipEventsBetween,
  countAnimaPoseClipEventsByKind,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipVFXEvent,
  parseAnimaPoseClip,
  sampleAnimaPoseClip,
  shouldAnimaPoseClipAutoComplete,
  type AnimaPoseClip,
  type AnimaPoseClipAvatarVFXEvent,
  type AnimaPoseClipDueEvent,
  type AnimaPoseClipEvent,
  type AnimaPoseClipParticleVFXEvent,
  type AnimaPoseClipSceneVFXEvent,
  type AnimaPoseClipSample,
  type AnimaPoseClipSFXEvent,
  type AnimaPoseClipVFXEvent,
} from "./animaPoseClip";
import {
  resolveAnimaPoseClipFadeDuration as resolveClipFadeDuration,
  resolveAnimaPoseClipFadeTransition as resolveClipFadeTransition,
} from "./animaPoseClip/playback";
import {
  easeProgress,
  interpolateSamples,
} from "./animaPoseClip/interpolation";
import type { AvatarPoseClipSnapshot, AvatarPoseSnapshot } from "./types";
import {
  ANIMA_POSE_CLIP_EPSILON,
  type AnimaPoseClipMutableLayerId,
} from "./animaPoseClip/schema";
import {
  retargetClipSampleForVrm0,
  retargetPoseForVrm0,
} from "./poseRetargeting";

export type PoseControllerApplyOptions = {
  /**
   * Deprecated compatibility option. Humanoid catalog poses are always
   * exclusive and reset to VRM T-pose before application. Passing false only
   * skips restoration of expression values captured for the previous pose.
   */
  clearPrevious?: boolean;
};

export type PoseControllerOptions = {
  isVrm0?: boolean;
  motionCatalog?: AvatarMotionCatalog;
};

export type FinitePoseClipPlayback = { timeScale: number; repetitions: number };

export type PoseControllerPlayClipOptions = {
  /** Finite idle occurrences use an authored clock and own cancellable events. */
  finitePlayback?: FinitePoseClipPlayback;
  fadeInDurationSec?: number | null;
};

export type PoseControllerStopClipOptions = {
  immediate?: boolean;
  fadeOutDurationSec?: number | null;
};

export type AnimaPoseClipEventContext = {
  clipId: string;
  eventId: string;
  appliedId: string;
  playbackTime: number;
  clipTime: number;
  occurrenceIndex: number;
  signal?: AbortSignal;
};

export type AnimaPoseClipEventSink = {
  applyAvatarVFX?: (
    event: AnimaPoseClipAvatarVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  clearAvatarVFX?: (
    event: AnimaPoseClipAvatarVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  applySceneVFX?: (
    event: AnimaPoseClipSceneVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  clearSceneVFX?: (
    event: AnimaPoseClipSceneVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  applyParticleVFX?: (
    event: AnimaPoseClipParticleVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  clearParticleVFX?: (
    event: AnimaPoseClipParticleVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
  playSfx?: (
    event: AnimaPoseClipSFXEvent,
    context: AnimaPoseClipEventContext,
  ) => void | Promise<void>;
};

type PoseRuntimeState = {
  enabled: boolean;
  params: AnimaPose;
  applied: boolean;
  resolvedBones: VRMHumanBoneName[];
  missingBones: VRMHumanBoneName[];
  resolvedExpressions: string[];
  missingExpressions: string[];
  expressionBaseline: Map<string, number>;
};

type PoseRuntimeStates = Record<string, PoseRuntimeState>;

type ClipActiveEventEffect = {
  event: AnimaPoseClipVFXEvent;
  context: AnimaPoseClipEventContext;
  clearAtPlaybackTime: number | null;
};

type ClipPlaybackPhase = "fadeIn" | "playing" | "fadeOut";

/** What a playing clip asks of the layers composed after it. */
export type AnimaPoseClipPresence = {
  /** 0–1: rises through the fade-in, 1 while playing, falls through the fade-out. */
  weight: number;
  /** Live procedural layers the clip mutes. */
  mutedLayers: readonly AnimaPoseClipMutableLayerId[];
  /** The clip's own sampled expression weights at the current time, before fades. */
  expressions: Readonly<Record<string, number>>;
};

type ClipRuntimeState = {
  clip: AnimaPoseClip | null;
  playbackId: number;
  finitePlayback: FinitePoseClipPlayback | null;
  eventAbort: AbortController | null;
  elapsedSec: number;
  fadeElapsedSec: number;
  phase: ClipPlaybackPhase;
  applied: boolean;
  playing: boolean;
  fadeInSourceSample: AnimaPoseClipSample | null;
  /** The pose the fade-in started from, kept so seeking can replay the fade. */
  fadeInStartSample: AnimaPoseClipSample | null;
  fadeOutSourceSample: AnimaPoseClipSample | null;
  fadeOutTargetSample: AnimaPoseClipSample | null;
  fadeInDurationSec: number;
  fadeOutDurationSec: number;
  resolvedBones: VRMHumanBoneName[];
  missingBones: VRMHumanBoneName[];
  resolvedExpressions: string[];
  missingExpressions: string[];
  missingPoseRefs: string[];
  /** Latest sampled clip expressions, before the fade envelope. */
  sampledExpressions: Record<string, number>;
  expressionBaseline: Map<string, number>;
  firedEventKeys: Set<string>;
  firedEventIds: Set<string>;
  activeEventEffects: Map<string, ClipActiveEventEffect>;
  skippedEventCount: number;
  eventErrorCount: number;
  lastEventError: string | null;
};

export class PoseController {
  private _vrm: VRM | null;
  private _isDisposed: boolean = false;
  private _poseStates: PoseRuntimeStates;
  private _activePoseId: string | null = null;
  private _clipState: ClipRuntimeState = createClipRuntimeState();
  private _clipEventSink: AnimaPoseClipEventSink | null = null;
  private _nextClipPlaybackId: number = 1;
  private _isVrm0: boolean;
  private readonly _motionCatalog: AvatarMotionCatalog;

  constructor(vrm: VRM, options: PoseControllerOptions = {}) {
    this._vrm = vrm;
    this._isVrm0 = options.isVrm0 === true;
    this._motionCatalog =
      options.motionCatalog ?? BUILT_IN_AVATAR_MOTION_CATALOG;
    this._poseStates = createPoseRuntimeStates(this._motionCatalog);
  }

  /**
   * Installs the side-effect boundary used by clip events. PoseController only
   * schedules typed events; avatar, scene, and sound systems own execution.
   */
  setClipEventSink(sink: AnimaPoseClipEventSink | null): void {
    this._clipEventSink = sink;
  }

  isPoseActive(poseId: string): boolean {
    const state = this._getPoseState(poseId);
    return (
      !this._isDisposed &&
      state.enabled &&
      state.applied &&
      this._activePoseId === poseId &&
      this._vrm !== null
    );
  }

  getPoseSnapshot(poseId: string): AvatarPoseSnapshot<AnimaPose> {
    return this._getPoseSnapshot(poseId);
  }

  isClipActive(clipId?: string): boolean {
    const clip = this._clipState.clip;
    return (
      !this._isDisposed &&
      this._vrm !== null &&
      this._clipState.playing &&
      clip !== null &&
      (!clipId || clip.id === clipId)
    );
  }

  /**
   * The playing clip's fade weight, layer mutes and sampled expressions, or
   * null when no clip is playing. Avatar uses it each frame to mute live
   * layers and give the clip's expressions precedence over emotion.
   */
  getClipPresence(): AnimaPoseClipPresence | null {
    const state = this._clipState;
    const clip = state.clip;
    if (!clip || !state.playing || this._isDisposed) return null;
    let weight = 1;
    if (state.phase === "fadeIn") {
      const transition = resolveClipFadeTransition(clip, clip.fadeIn);
      weight = easeProgress(
        this._getCurrentClipFadeProgress(state.fadeInDurationSec),
        transition.easing,
      );
    } else if (state.phase === "fadeOut") {
      const transition = resolveClipFadeTransition(clip, clip.fadeOut);
      weight =
        1 -
        easeProgress(
          this._getCurrentClipFadeProgress(state.fadeOutDurationSec),
          transition.easing,
        );
    }
    return {
      weight: Math.min(1, Math.max(0, weight)),
      mutedLayers: clip.mutedProceduralLayers ?? [],
      expressions: state.sampledExpressions,
    };
  }

  getClipSnapshot(clipId?: string): AvatarPoseClipSnapshot {
    return this._getClipSnapshot(clipId);
  }

  setPoseEnabled(poseId: string, enabled: boolean): boolean {
    const state = this._getPoseState(poseId);
    if (state.enabled === enabled) return false;
    state.enabled = enabled;
    return true;
  }

  setPoseParams(poseId: string, params: Partial<AnimaPose>): void {
    const state = this._getPoseState(poseId);
    state.params =
      sanitizeAnimaPose({ ...state.params, ...params }) ??
      cloneAnimaPose(state.params);
  }

  resetPoseDefaults(poseId: string): void {
    const state = this._getPoseState(poseId);
    state.enabled = true;
    state.params = this._motionCatalog.getPose(poseId);
  }

  reapplyPose(poseId: string): AvatarPoseSnapshot<AnimaPose> {
    return this.applyPose(poseId);
  }

  applyPose(
    poseId: string,
    options?: PoseControllerApplyOptions,
  ): AvatarPoseSnapshot<AnimaPose> {
    const state = this._getPoseState(poseId);
    const resolvedPose = this._resolvePoseParams(state.params);
    this._updateTargetSnapshot(state, resolvedPose);
    const shouldRestoreExpressions = options?.clearPrevious !== false;

    if (!this._vrm || this._isDisposed) {
      this._clearActiveClipState(shouldRestoreExpressions, false);
      this._clearActivePoseState(shouldRestoreExpressions);
      state.applied = false;
      return this._getPoseSnapshot(poseId);
    }

    if (!state.enabled || !hasAnimaPoseTargets(resolvedPose)) {
      this._clearActiveClipState(shouldRestoreExpressions, true);
      this._clearActivePoseState(shouldRestoreExpressions);
      this._resetHumanoidToRestPose();
      state.applied = false;
      return this._getPoseSnapshot(poseId);
    }

    this._clearActiveClipState(shouldRestoreExpressions, true);
    this._clearActivePoseState(shouldRestoreExpressions);
    this._resetHumanoidToRestPose();
    this._captureExpressionBaseline(state, resolvedPose);
    const result = applyAnimaPoseToVrm(
      this._vrm,
      this._retargetPoseForRuntime(resolvedPose),
    );
    this._updateApplySnapshot(state, result);
    state.applied =
      result.appliedHumanoidBones.length > 0 ||
      result.appliedExpressions.length > 0;
    this._activePoseId = state.applied ? poseId : null;
    return this._getPoseSnapshot(poseId);
  }

  applyDefaultPoses(options?: PoseControllerApplyOptions): void {
    for (const poseId of this._motionCatalog.getDefaultPoseIds()) {
      this.applyPose(poseId, options);
    }
  }

  playClip(
    clipId: string,
    options?: PoseControllerPlayClipOptions,
  ): AvatarPoseClipSnapshot {
    const clip = this._motionCatalog.getPoseClip(clipId);
    if (!clip) {
      throw new Error(`Unknown runtime pose clip id "${clipId}"`);
    }
    return this.playAnimaPoseClip(clip, options);
  }

  playAnimaPoseClip(
    clip: AnimaPoseClip,
    options?: PoseControllerPlayClipOptions,
  ): AvatarPoseClipSnapshot {
    const finite = options?.finitePlayback;
    // Admission combines the raw clip and Gesture config; these repetitions
    // therefore override the raw loop flag for this idle occurrence only.
    const sanitizedClip = parseAnimaPoseClip(
      finite ? { ...clip, loop: finite.repetitions > 1 } : clip,
    );
    if (
      finite &&
      (!Number.isFinite(finite.timeScale) ||
        finite.timeScale <= 0 ||
        !Number.isSafeInteger(finite.repetitions) ||
        finite.repetitions <= 0 ||
        !Number.isFinite(
          (getAnimaPoseClipTimelineDuration(sanitizedClip) *
            finite.repetitions) /
            finite.timeScale,
        ) ||
        getAnimaPoseClipTimelineDuration(sanitizedClip) <= 0 ||
        sanitizedClip.playback)
    ) {
      throw new Error(
        "Finite clip playback requires positive duration, speed and repetition count.",
      );
    }
    const fadeInDurationSec = resolveClipFadeDuration(
      sanitizedClip.fadeIn,
      options?.fadeInDurationSec,
    );
    const fadeInSourceSample =
      fadeInDurationSec > 0
        ? this._captureCurrentSample(
            getClipExpressionNames(sanitizedClip, this._resolveClipPoseRef),
          )
        : null;

    // An event-only clip does not replace the selected body/expression pose.
    const hasPoseKeyframes = sanitizedClip.poseKeyframes.length > 0;
    const hadActivePose = hasPoseKeyframes && this._activePoseId !== null;
    if (hasPoseKeyframes) this._clearActivePoseState(true);
    this._clearActiveClipState(true, false);
    if (hadActivePose) {
      this._resetHumanoidToRestPose();
    }
    this._clipState = {
      ...createClipRuntimeState(),
      clip: sanitizedClip,
      playbackId: this._nextClipPlaybackId,
      finitePlayback: finite ?? null,
      eventAbort: finite ? new AbortController() : null,
      phase: fadeInDurationSec > 0 ? "fadeIn" : "playing",
      fadeInSourceSample,
      fadeInStartSample: fadeInSourceSample,
      fadeInDurationSec,
      playing: Boolean(this._vrm && !this._isDisposed),
    };
    this._nextClipPlaybackId += 1;

    if (this._clipState.playing) {
      this._applyClipSampleAtTime(0);
      this._dispatchClipEventsBetween(0, 0, { includeStart: true });
    }

    return this._getClipSnapshot(sanitizedClip.id);
  }

  stopClip(options?: PoseControllerStopClipOptions): boolean {
    if (this._clipState.eventAbort) {
      this._clipState.eventAbort.abort();
      this._clearAllClipEventEffects();
    }
    if (
      options?.immediate !== true &&
      this._beginClipFadeOutIfAvailable({
        fadeOutDurationSec: options?.fadeOutDurationSec,
      })
    ) {
      return false;
    }

    this._clearActiveClipState(true, true);
    return true;
  }

  update(deltaSec: number): void {
    const clip = this._clipState.clip;
    if (!clip || !this._clipState.playing || !this._vrm || this._isDisposed) {
      return;
    }

    const delta = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    const previousElapsedSec = this._clipState.elapsedSec;
    const finite = this._clipState.finitePlayback;
    const horizon = finite
      ? getAnimaPoseClipTimelineDuration(clip) * finite.repetitions
      : Infinity;
    const nextElapsedSec = Math.min(
      horizon,
      this._clipState.elapsedSec + delta * (finite?.timeScale ?? 1),
    );
    this._clipState.elapsedSec = nextElapsedSec;
    if (this._clipState.phase !== "playing") {
      this._clipState.fadeElapsedSec += delta;
    }

    this._applyClipSampleAtTime(nextElapsedSec);

    if (this._clipState.phase === "fadeOut") {
      this._clearExpiredClipEventEffects(nextElapsedSec);
      if (this._isCurrentClipFadeComplete(this._clipState.fadeOutDurationSec)) {
        this.stopClip({ immediate: true });
      }
      return;
    }

    this._clearExpiredClipEventEffects(nextElapsedSec);
    this._dispatchClipEventsBetween(previousElapsedSec, nextElapsedSec);

    if (
      this._clipState.phase === "fadeIn" &&
      this._isCurrentClipFadeComplete(this._clipState.fadeInDurationSec)
    ) {
      this._clipState.phase = "playing";
      this._clipState.fadeElapsedSec = 0;
      this._clipState.fadeInSourceSample = null;
    }

    if (finite && nextElapsedSec >= horizon) {
      this.stopClip({ immediate: true });
      return;
    }
    if (shouldAnimaPoseClipAutoComplete(clip, nextElapsedSec)) {
      if (!this._beginClipFadeOutIfAvailable()) {
        this.stopClip({ immediate: true });
      }
    }
  }

  /**
   * Move the playing clip to `timeSec` on its playback clock, as if it had
   * played there. The fade-in, playing and (for a one-shot) fade-out phases
   * follow from the time; a time past the end holds the final frame instead
   * of finishing playback. Events at or before the time count as fired: none
   * are dispatched and running event effects are cleared, so later events
   * fire when playback resumes. The next `update` applies the pose. Review
   * tools use this to scrub. Returns false when no clip is playing.
   */
  seekClip(timeSec: number): boolean {
    const state = this._clipState;
    const clip = state.clip;
    if (
      !clip ||
      !state.playing ||
      !this._vrm ||
      this._isDisposed ||
      state.finitePlayback
    )
      return false;
    const time = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
    const duration = getAnimaPoseClipTimelineDuration(clip);
    const pastEnd = shouldAnimaPoseClipAutoComplete(clip, time);
    // Keep the final frame without reaching the completion threshold.
    const hold = Math.max(0, duration - 2 * ANIMA_POSE_CLIP_EPSILON);

    this._clearAllClipEventEffects();
    state.firedEventKeys.clear();
    state.firedEventIds.clear();
    for (const dueEvent of collectAnimaPoseClipEventsBetween(
      clip,
      0,
      pastEnd ? duration : time,
      { includeStart: true },
    )) {
      state.firedEventKeys.add(getDueEventKey(dueEvent));
      state.firedEventIds.add(dueEvent.event.id);
    }

    state.fadeOutSourceSample = null;
    state.fadeOutTargetSample = null;
    if (time < state.fadeInDurationSec && !pastEnd) {
      state.elapsedSec = time;
      state.phase = "fadeIn";
      state.fadeElapsedSec = time;
      state.fadeInSourceSample = state.fadeInStartSample;
      return true;
    }
    state.phase = "playing";
    state.fadeElapsedSec = 0;
    state.fadeInSourceSample = null;
    state.elapsedSec = pastEnd ? hold : time;
    if (pastEnd) {
      // Fade out from the final frame, as natural completion does.
      this._applyClipSampleAtTime(hold);
      if (this._beginClipFadeOutIfAvailable()) {
        state.fadeElapsedSec = Math.min(
          time - duration,
          state.fadeOutDurationSec - ANIMA_POSE_CLIP_EPSILON,
        );
      }
    }
    return true;
  }

  clearPose(poseId: string): void {
    const state = this._getPoseState(poseId);
    if (this._activePoseId !== poseId) {
      this.forgetPose(poseId);
      return;
    }

    if (this._vrm && !this._isDisposed) {
      this._restoreExpressionBaseline(state);
      this._resetHumanoidToRestPose();
    }
    this.forgetPose(poseId);
  }

  clearDefaultPoseOffsets(): void {
    for (const poseId of this._motionCatalog.getDefaultPoseIds()) {
      this.clearPose(poseId);
    }
  }

  forgetPose(poseId: string): void {
    const state = this._getPoseState(poseId);
    state.expressionBaseline.clear();
    state.applied = false;
    if (this._activePoseId === poseId) {
      this._activePoseId = null;
    }
  }

  forgetDefaultPoseOffsets(): void {
    for (const poseId of this._motionCatalog.getDefaultPoseIds()) {
      this.forgetPose(poseId);
    }
  }

  dispose(): void {
    this.stopClip({ immediate: true });
    for (const poseId of this._motionCatalog.getPoseIds()) {
      this.clearPose(poseId);
      const state = this._getPoseState(poseId);
      state.resolvedBones = [];
      state.missingBones = [];
      state.resolvedExpressions = [];
      state.missingExpressions = [];
    }
    this._vrm = null;
    this._isDisposed = true;
  }

  /**
   * Dispatches clip events crossed by the current playback step. Event keys are
   * recorded defensively so a zero-delta frame or boundary poll cannot replay.
   */
  private _dispatchClipEventsBetween(
    fromPlaybackTimeSec: number,
    toPlaybackTimeSec: number,
    options?: { includeStart?: boolean },
  ): void {
    const clip = this._clipState.clip;
    if (!clip || !this._clipState.playing) return;

    const dueEvents = collectAnimaPoseClipEventsBetween(
      clip,
      fromPlaybackTimeSec,
      toPlaybackTimeSec,
      options,
    );

    for (const dueEvent of dueEvents) {
      if (
        this._clipState.finitePlayback &&
        dueEvent.occurrenceIndex >= this._clipState.finitePlayback.repetitions
      )
        continue;
      const eventKey = getDueEventKey(dueEvent);
      if (this._clipState.firedEventKeys.has(eventKey)) continue;
      this._clipState.firedEventKeys.add(eventKey);
      this._clipState.firedEventIds.add(dueEvent.event.id);
      this._dispatchClipEvent(dueEvent);
    }
  }

  private _dispatchClipEvent(dueEvent: AnimaPoseClipDueEvent): void {
    const clip = this._clipState.clip;
    if (!clip) return;

    const event = dueEvent.event;
    const context: AnimaPoseClipEventContext = {
      clipId: clip.id,
      eventId: event.id,
      appliedId: getClipEventAppliedId(
        this._clipState.eventAbort
          ? `${clip.id}:${this._clipState.playbackId}`
          : clip.id,
        event.id,
      ),
      signal: this._clipState.eventAbort?.signal,
      playbackTime: dueEvent.playbackTime,
      clipTime: dueEvent.clipTime,
      occurrenceIndex: dueEvent.occurrenceIndex,
    };

    if (event.kind === "avatar_vfx") {
      this._dispatchAvatarVFXEvent(event, context);
      return;
    }
    if (event.kind === "scene_vfx") {
      this._dispatchSceneVFXEvent(event, context);
      return;
    }
    if (event.kind === "particle_vfx") {
      this._dispatchParticleVFXEvent(event, context);
      return;
    }
    this._dispatchSFXEvent(event, context);
  }

  private _dispatchAvatarVFXEvent(
    event: AnimaPoseClipAvatarVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    const handler = this._clipEventSink?.applyAvatarVFX;
    if (!handler) {
      this._recordSkippedClipEvent();
      return;
    }

    this._trackActiveClipVFXEvent(event, context);
    this._invokeClipEventHandler(event, context, () => handler(event, context));
  }

  private _dispatchSceneVFXEvent(
    event: AnimaPoseClipSceneVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    const handler = this._clipEventSink?.applySceneVFX;
    if (!handler) {
      this._recordSkippedClipEvent();
      return;
    }

    this._trackActiveClipVFXEvent(event, context);
    this._invokeClipEventHandler(event, context, () => handler(event, context));
  }

  private _dispatchParticleVFXEvent(
    event: AnimaPoseClipParticleVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    const handler = this._clipEventSink?.applyParticleVFX;
    if (!handler) {
      this._recordSkippedClipEvent();
      return;
    }

    this._trackActiveClipVFXEvent(event, context);
    this._invokeClipEventHandler(event, context, () => handler(event, context));
  }

  private _dispatchSFXEvent(
    event: AnimaPoseClipSFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    const handler = this._clipEventSink?.playSfx;
    if (!handler) {
      this._recordSkippedClipEvent();
      return;
    }

    this._invokeClipEventHandler(event, context, () => handler(event, context));
  }

  private _trackActiveClipVFXEvent(
    event: AnimaPoseClipVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    if (!isAnimaPoseClipVFXEvent(event)) return;
    this._clearClipEventEffect(context.appliedId);
    this._clipState.activeEventEffects.set(context.appliedId, {
      event,
      context,
      clearAtPlaybackTime:
        event.duration === undefined
          ? null
          : context.playbackTime + event.duration,
    });
  }

  private _clearExpiredClipEventEffects(playbackTimeSec: number): void {
    for (const activeEffect of Array.from(
      this._clipState.activeEventEffects.values(),
    )) {
      if (
        activeEffect.clearAtPlaybackTime !== null &&
        activeEffect.clearAtPlaybackTime <= playbackTimeSec
      ) {
        this._clearClipEventEffect(activeEffect.context.appliedId);
      }
    }
  }

  private _clearAllClipEventEffects(): void {
    for (const appliedId of Array.from(
      this._clipState.activeEventEffects.keys(),
    )) {
      this._clearClipEventEffect(appliedId);
    }
  }

  private _clearClipEventEffect(appliedId: string): void {
    const activeEffect = this._clipState.activeEventEffects.get(appliedId);
    if (!activeEffect) return;
    this._clipState.activeEventEffects.delete(appliedId);

    const { event, context } = activeEffect;
    if (event.kind === "avatar_vfx") {
      const handler = this._clipEventSink?.clearAvatarVFX;
      if (!handler) {
        this._recordSkippedClipEvent();
        return;
      }
      this._invokeClipEventHandler(event, context, () =>
        handler(event, context),
      );
      return;
    }

    if (event.kind === "particle_vfx") {
      const handler = this._clipEventSink?.clearParticleVFX;
      if (!handler) {
        this._recordSkippedClipEvent();
        return;
      }
      this._invokeClipEventHandler(event, context, () =>
        handler(event, context),
      );
      return;
    }

    const handler = this._clipEventSink?.clearSceneVFX;
    if (!handler) {
      this._recordSkippedClipEvent();
      return;
    }
    this._invokeClipEventHandler(event, context, () => handler(event, context));
  }

  private _invokeClipEventHandler(
    event: AnimaPoseClipEvent,
    context: AnimaPoseClipEventContext,
    run: () => void | Promise<void>,
  ): void {
    const playbackId = this._clipState.playbackId;
    try {
      void Promise.resolve(run()).catch((error) => {
        this._recordClipEventError(playbackId, event, context, error);
      });
    } catch (error) {
      this._recordClipEventError(playbackId, event, context, error);
    }
  }

  private _recordSkippedClipEvent(): void {
    this._clipState.skippedEventCount += 1;
  }

  private _recordClipEventError(
    playbackId: number,
    event: AnimaPoseClipEvent,
    context: AnimaPoseClipEventContext,
    error: unknown,
  ): void {
    if (this._clipState.playbackId !== playbackId) return;
    if (isAnimaPoseClipVFXEvent(event)) {
      this._clipState.activeEventEffects.delete(context.appliedId);
    }
    this._clipState.eventErrorCount += 1;
    this._clipState.lastEventError = formatClipEventError(
      event,
      context,
      error,
    );
  }

  private _applyClipSampleAtTime(timeSec: number): void {
    const clip = this._clipState.clip;
    if (!clip || !this._vrm || this._isDisposed) return;
    // Fades must not synthesize body samples from the current/default pose for
    // a clip that only owns effects. Its event clock still advances normally.
    if (clip.poseKeyframes.length === 0) return;

    const finite = this._clipState.finitePlayback;
    const cycle = finite ? getAnimaPoseClipTimelineDuration(clip) : 0;
    const atFiniteEnd = finite && timeSec >= cycle * finite.repetitions;
    const sampleResult = sampleAnimaPoseClip(
      atFiniteEnd ? { ...clip, loop: false } : clip,
      atFiniteEnd ? cycle : timeSec,
      this._resolveClipPoseRef,
    );
    this._clipState.sampledExpressions = {
      ...(sampleResult.sample.expressions ?? {}),
    };
    const result = this._applyClipSample(
      this._applyClipPlaybackEnvelope(
        this._retargetClipSampleForRuntime(sampleResult.sample),
      ),
    );
    this._clipState.resolvedBones = result.appliedHumanoidBones;
    this._clipState.missingBones = result.skippedHumanoidBones;
    this._clipState.resolvedExpressions = result.appliedExpressions;
    this._clipState.missingExpressions = result.skippedExpressions;
    this._clipState.missingPoseRefs = [
      ...sampleResult.diagnostics.missingPoseRefs,
    ];
    this._clipState.applied =
      result.appliedHumanoidBones.length > 0 ||
      result.appliedExpressions.length > 0;
  }

  private _applyClipPlaybackEnvelope(
    sample: AnimaPoseClipSample,
  ): AnimaPoseClipSample {
    const clip = this._clipState.clip;
    if (!clip) return sample;

    if (this._clipState.phase === "fadeIn") {
      const transition = resolveClipFadeTransition(clip, clip.fadeIn);
      const progress = this._getCurrentClipFadeProgress(
        this._clipState.fadeInDurationSec,
      );
      return interpolateSamples(
        this._clipState.fadeInSourceSample ?? {},
        sample,
        progress,
        easeProgress(progress, transition.easing),
        transition,
      );
    }

    if (this._clipState.phase === "fadeOut") {
      const transition = resolveClipFadeTransition(clip, clip.fadeOut);
      const progress = this._getCurrentClipFadeProgress(
        this._clipState.fadeOutDurationSec,
      );
      const sourceSample = this._clipState.fadeOutSourceSample ?? sample;
      const targetSample =
        this._clipState.fadeOutTargetSample ??
        this._createDefaultPoseSample(getSampleExpressionNames(sourceSample));
      return interpolateSamples(
        sourceSample,
        targetSample,
        progress,
        easeProgress(progress, transition.easing),
        transition,
      );
    }

    return sample;
  }

  private _beginClipFadeOutIfAvailable(options?: {
    fadeOutDurationSec?: number | null;
  }): boolean {
    const clip = this._clipState.clip;
    const fadeOutDurationSec = resolveClipFadeDuration(
      clip?.fadeOut,
      options?.fadeOutDurationSec,
    );
    if (
      !clip ||
      !this._clipState.playing ||
      this._clipState.phase === "fadeOut" ||
      fadeOutDurationSec <= 0
    ) {
      return false;
    }

    const currentSample = sampleAnimaPoseClip(
      clip,
      this._clipState.elapsedSec,
      this._resolveClipPoseRef,
    ).sample;
    const currentExpressionNames = getSampleExpressionNames(currentSample);
    const fadeOutSourceSample = this._captureCurrentSample(
      currentExpressionNames,
    );
    this._clipState.phase = "fadeOut";
    this._clipState.fadeElapsedSec = 0;
    this._clipState.fadeInSourceSample = null;
    this._clipState.fadeOutSourceSample = fadeOutSourceSample;
    this._clipState.fadeOutDurationSec = fadeOutDurationSec;
    this._clipState.fadeOutTargetSample = this._createDefaultPoseSample(
      currentExpressionNames,
    );
    this._applyClipSampleAtTime(this._clipState.elapsedSec);
    return true;
  }

  private _getCurrentClipFadeProgress(duration: number) {
    if (duration <= 0) return 1;
    return clamp01(this._clipState.fadeElapsedSec / duration);
  }

  private _isCurrentClipFadeComplete(duration: number): boolean {
    return duration <= 0 || this._clipState.fadeElapsedSec >= duration;
  }

  private _captureCurrentSample(
    expressionNames: readonly string[] = [],
  ): AnimaPoseClipSample {
    if (!this._vrm || this._isDisposed) return {};

    const expressionManager = this._vrm.expressionManager;
    const expressions: Record<string, number> = {};
    for (const expressionName of expressionNames) {
      if (!expressionManager?.getExpression(expressionName)) continue;
      expressions[expressionName] =
        expressionManager.getValue(expressionName) ?? 0;
    }

    return {
      humanoid: cloneVRMPose(this._vrm.humanoid.getNormalizedPose()),
      ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
    };
  }

  private _createDefaultPoseSample(
    expressionNames: readonly string[] = [],
  ): AnimaPoseClipSample {
    let sample: AnimaPoseClipSample = {};
    for (const poseId of this._motionCatalog.getDefaultPoseIds()) {
      try {
        sample = mergeClipSamples(
          sample,
          this._motionCatalog.getResolvedPose(poseId),
        );
      } catch {
        // Defaults are validated at catalog load; ignore only to keep cleanup safe.
      }
    }

    const expressions: Record<string, number> = {};
    for (const expressionName of expressionNames) {
      expressions[expressionName] =
        this._clipState.expressionBaseline.get(expressionName) ?? 0;
    }

    return this._retargetClipSampleForRuntime(
      mergeClipSamples(sample, {
        ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
      }),
    );
  }

  private _applyClipSample(sample: AnimaPoseClipSample): AnimaPoseApplyResult {
    const result: AnimaPoseApplyResult = {
      appliedHumanoidBones: [],
      skippedHumanoidBones: [],
      appliedExpressions: [],
      skippedExpressions: [],
    };
    if (!this._vrm || this._isDisposed) return result;

    const humanoidPose = sample.humanoid;
    if (humanoidPose && Object.keys(humanoidPose).length > 0) {
      const mergedPose = cloneVRMPose(this._vrm.humanoid.getNormalizedPose());
      for (const boneName of getSampleHumanoidBoneNames(humanoidPose)) {
        const transform = humanoidPose[boneName];
        if (!transform || !this._vrm.humanoid.getNormalizedBoneNode(boneName)) {
          result.skippedHumanoidBones.push(boneName);
          continue;
        }

        mergedPose[boneName] = cloneVRMPoseTransform(transform);
        result.appliedHumanoidBones.push(boneName);
      }

      if (result.appliedHumanoidBones.length > 0) {
        this._vrm.humanoid.setNormalizedPose(mergedPose);
      }
    }

    const expressionManager = this._vrm.expressionManager;
    const expressions = sample.expressions;
    if (expressions) {
      for (const [expressionName, weight] of Object.entries(expressions)) {
        if (!expressionManager?.getExpression(expressionName)) {
          result.skippedExpressions.push(expressionName);
          continue;
        }

        this._captureClipExpressionBaseline(expressionName);
        expressionManager.setValue(expressionName, weight);
        result.appliedExpressions.push(expressionName);
      }

      if (result.appliedExpressions.length > 0) {
        expressionManager?.update();
      }
    }

    return result;
  }

  private _captureExpressionBaseline(
    state: PoseRuntimeState,
    pose: AnimaPose,
  ): void {
    if (!this._vrm) return;
    state.expressionBaseline.clear();
    const expressionManager = this._vrm.expressionManager;
    if (!expressionManager) return;
    for (const expressionName of getAnimaPoseExpressionNames(pose)) {
      if (!expressionManager.getExpression(expressionName)) continue;
      state.expressionBaseline.set(
        expressionName,
        expressionManager.getValue(expressionName) ?? 0,
      );
    }
  }

  private _restoreExpressionBaseline(state: PoseRuntimeState): void {
    const expressionManager = this._vrm?.expressionManager;
    if (!expressionManager || state.expressionBaseline.size === 0) return;

    let didRestore = false;
    for (const [expressionName, weight] of state.expressionBaseline.entries()) {
      if (!expressionManager.getExpression(expressionName)) continue;
      expressionManager.setValue(expressionName, weight);
      didRestore = true;
    }

    if (didRestore) {
      expressionManager.update();
    }
  }

  private _captureClipExpressionBaseline(expressionName: string): void {
    if (this._clipState.expressionBaseline.has(expressionName)) return;
    const expressionManager = this._vrm?.expressionManager;
    if (!expressionManager?.getExpression(expressionName)) return;
    this._clipState.expressionBaseline.set(
      expressionName,
      expressionManager.getValue(expressionName) ?? 0,
    );
  }

  private _restoreClipExpressionBaseline(): void {
    const expressionManager = this._vrm?.expressionManager;
    if (!expressionManager || this._clipState.expressionBaseline.size === 0) {
      return;
    }

    let didRestore = false;
    for (const [
      expressionName,
      weight,
    ] of this._clipState.expressionBaseline.entries()) {
      if (!expressionManager.getExpression(expressionName)) continue;
      expressionManager.setValue(expressionName, weight);
      didRestore = true;
    }

    if (didRestore) {
      expressionManager.update();
    }
  }

  private _clearActivePoseState(restoreExpressions: boolean): void {
    const activeState = this._activePoseId
      ? this._poseStates[this._activePoseId]
      : null;
    if (restoreExpressions && activeState && this._vrm && !this._isDisposed) {
      this._restoreExpressionBaseline(activeState);
    }

    for (const state of Object.values(this._poseStates)) {
      state.expressionBaseline.clear();
      state.applied = false;
    }
    this._activePoseId = null;
  }

  private _clearActiveClipState(
    restoreExpressions: boolean,
    resetHumanoid: boolean,
  ): void {
    this._clipState.eventAbort?.abort();
    this._clearAllClipEventEffects();
    if (restoreExpressions && this._vrm && !this._isDisposed) {
      this._restoreClipExpressionBaseline();
    }
    if (resetHumanoid && this._clipState.clip?.poseKeyframes.length !== 0) {
      this._resetHumanoidToRestPose();
    }
    this._clipState = createClipRuntimeState();
  }

  private _resetHumanoidToRestPose(): void {
    if (!this._vrm || this._isDisposed) return;
    this._vrm.humanoid.resetNormalizedPose();
  }

  private _updateTargetSnapshot(
    state: PoseRuntimeState,
    pose: AnimaPose,
  ): void {
    const humanoidBoneNames = getAnimaPoseHumanoidBoneNames(pose);
    const expressionNames = getAnimaPoseExpressionNames(pose);

    if (!this._vrm || this._isDisposed) {
      state.resolvedBones = [];
      state.missingBones = humanoidBoneNames;
      state.resolvedExpressions = [];
      state.missingExpressions = expressionNames;
      return;
    }

    state.resolvedBones = humanoidBoneNames.filter((boneName) =>
      Boolean(this._vrm?.humanoid.getNormalizedBoneNode(boneName)),
    );
    state.missingBones = humanoidBoneNames.filter(
      (boneName) => !this._vrm?.humanoid.getNormalizedBoneNode(boneName),
    );
    state.resolvedExpressions = expressionNames.filter((expressionName) =>
      Boolean(this._vrm?.expressionManager?.getExpression(expressionName)),
    );
    state.missingExpressions = expressionNames.filter(
      (expressionName) =>
        !this._vrm?.expressionManager?.getExpression(expressionName),
    );
  }

  private _updateApplySnapshot(
    state: PoseRuntimeState,
    result: AnimaPoseApplyResult,
  ): void {
    state.resolvedBones = result.appliedHumanoidBones;
    state.missingBones = result.skippedHumanoidBones;
    state.resolvedExpressions = result.appliedExpressions;
    state.missingExpressions = result.skippedExpressions;
  }

  private _getPoseSnapshot(poseId: string): AvatarPoseSnapshot<AnimaPose> {
    const state = this._getPoseState(poseId);
    return {
      ready: Boolean(this._vrm && !this._isDisposed),
      enabled: state.enabled,
      applied: state.applied && this._activePoseId === poseId,
      params: cloneAnimaPose(state.params),
      resolvedBones: [...state.resolvedBones],
      missingBones: [...state.missingBones],
      resolvedExpressions: [...state.resolvedExpressions],
      missingExpressions: [...state.missingExpressions],
    };
  }

  private _getClipSnapshot(clipId?: string): AvatarPoseClipSnapshot {
    const activeClip = this._clipState.clip;
    if (activeClip && (!clipId || activeClip.id === clipId)) {
      return {
        ready: Boolean(this._vrm && !this._isDisposed),
        applied: this._clipState.applied,
        playing: this._clipState.playing,
        clipId: activeClip.id,
        elapsedSec: this._clipState.elapsedSec,
        durationSec: getAnimaPoseClipTimelineDuration(activeClip),
        loop: activeClip.loop === true,
        resolvedBones: [...this._clipState.resolvedBones],
        missingBones: [...this._clipState.missingBones],
        resolvedExpressions: [...this._clipState.resolvedExpressions],
        missingExpressions: [...this._clipState.missingExpressions],
        missingPoseRefs: [...this._clipState.missingPoseRefs],
        eventCount: activeClip.events?.length ?? 0,
        eventKindCounts: countAnimaPoseClipEventsByKind(activeClip),
        firedEventCount: this._clipState.firedEventKeys.size,
        firedEventIds: [...this._clipState.firedEventIds].sort(),
        activeEventCount: this._clipState.activeEventEffects.size,
        eventDispatchAvailable: hasClipEventSink(this._clipEventSink),
        skippedEventCount: this._clipState.skippedEventCount,
        eventErrorCount: this._clipState.eventErrorCount,
        lastEventError: this._clipState.lastEventError,
      };
    }

    const catalogClip = clipId ? this._motionCatalog.getPoseClip(clipId) : null;
    return {
      ready: Boolean(this._vrm && !this._isDisposed),
      applied: false,
      playing: false,
      clipId: catalogClip?.id ?? clipId ?? null,
      elapsedSec: 0,
      durationSec: catalogClip
        ? getAnimaPoseClipTimelineDuration(catalogClip)
        : 0,
      loop: catalogClip?.loop === true,
      resolvedBones: [],
      missingBones: [],
      resolvedExpressions: [],
      missingExpressions: [],
      missingPoseRefs: [],
      eventCount: catalogClip?.events?.length ?? 0,
      eventKindCounts: countAnimaPoseClipEventsByKind(catalogClip),
      firedEventCount: 0,
      firedEventIds: [],
      activeEventCount: 0,
      eventDispatchAvailable: hasClipEventSink(this._clipEventSink),
      skippedEventCount: 0,
      eventErrorCount: 0,
      lastEventError: null,
    };
  }

  private _getPoseState(poseId: string): PoseRuntimeState {
    const state = this._poseStates[poseId];
    if (!state) {
      throw new Error(`Unknown avatar pose id "${poseId}"`);
    }
    return state;
  }

  private _resolveClipPoseRef = (poseId: string) => {
    try {
      return this._motionCatalog.getResolvedPose(poseId);
    } catch {
      return null;
    }
  };

  private _resolveRawPoseRef = (poseId: string) => {
    try {
      return this._motionCatalog.getPose(poseId);
    } catch {
      return null;
    }
  };

  private _resolvePoseParams(pose: AnimaPose): ResolvedAnimaPose {
    return resolveAnimaPose(pose, this._resolveRawPoseRef);
  }

  private _retargetPoseForRuntime(pose: AnimaPose): AnimaPose {
    return this._isVrm0 ? retargetPoseForVrm0(pose) : pose;
  }

  private _retargetClipSampleForRuntime(
    sample: AnimaPoseClipSample,
  ): AnimaPoseClipSample {
    return this._isVrm0 ? retargetClipSampleForVrm0(sample) : sample;
  }
}

function createPoseRuntimeStates(
  motionCatalog: AvatarMotionCatalog,
): PoseRuntimeStates {
  return Object.fromEntries(
    motionCatalog
      .getPoseIds()
      .map((poseId) => [
        poseId,
        createPoseRuntimeState(motionCatalog.getPose(poseId)),
      ]),
  );
}

function createPoseRuntimeState(defaultPose: AnimaPose): PoseRuntimeState {
  return {
    enabled: true,
    params: cloneAnimaPose(defaultPose),
    applied: false,
    resolvedBones: [],
    missingBones: [],
    resolvedExpressions: [],
    missingExpressions: [],
    expressionBaseline: new Map<string, number>(),
  };
}

function createClipRuntimeState(): ClipRuntimeState {
  return {
    clip: null,
    playbackId: 0,
    finitePlayback: null,
    eventAbort: null,
    elapsedSec: 0,
    fadeElapsedSec: 0,
    phase: "playing",
    applied: false,
    playing: false,
    fadeInSourceSample: null,
    fadeInStartSample: null,
    fadeOutSourceSample: null,
    fadeOutTargetSample: null,
    fadeInDurationSec: 0,
    fadeOutDurationSec: 0,
    resolvedBones: [],
    missingBones: [],
    resolvedExpressions: [],
    missingExpressions: [],
    missingPoseRefs: [],
    sampledExpressions: {},
    expressionBaseline: new Map<string, number>(),
    firedEventKeys: new Set<string>(),
    firedEventIds: new Set<string>(),
    activeEventEffects: new Map<string, ClipActiveEventEffect>(),
    skippedEventCount: 0,
    eventErrorCount: 0,
    lastEventError: null,
  };
}

function hasAnimaPoseTargets(pose: AnimaPose): boolean {
  return (
    getAnimaPoseHumanoidBoneNames(pose).length > 0 ||
    getAnimaPoseExpressionNames(pose).length > 0
  );
}

function getClipExpressionNames(
  clip: AnimaPoseClip,
  resolvePoseRef: (poseId: string) => AnimaPose | AnimaPoseClipSample | null,
): string[] {
  const expressionNames = new Set<string>();
  for (const keyframe of clip.poseKeyframes) {
    const result = sampleAnimaPoseClip(clip, keyframe.time, resolvePoseRef);
    for (const expressionName of getSampleExpressionNames(result.sample)) {
      expressionNames.add(expressionName);
    }
  }
  return [...expressionNames];
}

function getSampleExpressionNames(sample: AnimaPoseClipSample): string[] {
  return Object.keys(sample.expressions ?? {});
}

function mergeClipSamples(
  baseSample: AnimaPoseClipSample,
  overlaySample: AnimaPoseClipSample,
): AnimaPoseClipSample {
  return {
    ...(baseSample.humanoid || overlaySample.humanoid
      ? {
          humanoid: mergeClipHumanoidSamples(
            baseSample.humanoid,
            overlaySample.humanoid,
          ),
        }
      : {}),
    ...(baseSample.expressions || overlaySample.expressions
      ? {
          expressions: {
            ...(baseSample.expressions ?? {}),
            ...(overlaySample.expressions ?? {}),
          },
        }
      : {}),
  };
}

function mergeClipHumanoidSamples(
  basePose: VRMPose | undefined,
  overlayPose: VRMPose | undefined,
): VRMPose {
  const pose = basePose ? cloneVRMPose(basePose) : {};
  for (const boneName of Object.keys(overlayPose ?? {}).filter(
    isVRMHumanBoneName,
  ) as VRMHumanBoneName[]) {
    const overlayTransform = overlayPose?.[boneName];
    if (!overlayTransform) continue;
    pose[boneName] = cloneVRMPoseTransform(overlayTransform);
  }
  return pose;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getSampleHumanoidBoneNames(pose: VRMPose): VRMHumanBoneName[] {
  return Object.keys(pose).filter(isVRMHumanBoneName) as VRMHumanBoneName[];
}

function getDueEventKey(dueEvent: AnimaPoseClipDueEvent): string {
  return `${dueEvent.event.id}:${dueEvent.occurrenceIndex}:${dueEvent.playbackTime}`;
}

function getClipEventAppliedId(clipId: string, eventId: string): string {
  return `poseClip:${clipId}:${eventId}`;
}

function hasClipEventSink(sink: AnimaPoseClipEventSink | null): boolean {
  return Boolean(
    sink?.applyAvatarVFX ||
    sink?.clearAvatarVFX ||
    sink?.applySceneVFX ||
    sink?.clearSceneVFX ||
    sink?.applyParticleVFX ||
    sink?.clearParticleVFX ||
    sink?.playSfx,
  );
}

function formatClipEventError(
  event: AnimaPoseClipEvent,
  context: AnimaPoseClipEventContext,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${event.kind}:${context.eventId} failed: ${message}`;
}
