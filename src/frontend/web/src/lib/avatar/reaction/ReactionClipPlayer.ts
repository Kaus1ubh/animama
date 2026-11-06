import { createLogger } from "@/lib/logger";
import {
  collectAnimaPoseClipEventsBetween,
  countAnimaPoseClipEventsByKind,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipVFXEvent,
  parseAnimaPoseClip,
  sampleAnimaPoseClipAvatarVFXIntensity,
  shouldAnimaPoseClipAutoComplete,
  type AnimaPoseClipV2,
  type AnimaPoseClipDueEvent,
  type AnimaPoseClipEasing,
  type AnimaPoseClipEventKindCounts,
  type AnimaPoseClipEvent,
  type AnimaPoseClipParticleVFXEvent,
  type AnimaPoseClipPoseResolver,
  type AnimaPoseClipSample,
  type AnimaPoseClipVFXEvent,
} from "../poses/animaPoseClip";
import {
  createAnimaPoseClipProgram,
  type AnimaPoseClipProgram,
} from "../poses/animaPoseClip/program";
import {
  resolveAnimaPoseClipFadeDuration,
  resolveAnimaPoseClipFadeTransition,
} from "../poses/animaPoseClip/playback";
import {
  easeProgress,
  interpolateSamples,
} from "../poses/animaPoseClip/interpolation";
import type {
  AnimaPoseClipEventContext,
  AnimaPoseClipEventSink,
} from "../poses/PoseController";

export type ReactionExpressionOverlaySink = {
  setExpressionOverlay: (
    ownerId: string,
    expressions: Record<string, number>,
  ) => boolean;
  clearExpressionOverlay: (ownerId: string) => boolean;
};

export type ReactionClipPlayRequest = {
  ownerId: string;
  runId: string;
  sourceEventId: string;
  emotionEventId: string | null;
  clip: AnimaPoseClipV2;
};

export type ReactionClipPlayerOptions = {
  eventSink?: AnimaPoseClipEventSink | null;
  resolvePoseRef?: AnimaPoseClipPoseResolver;
};

export type ReactionClipClearOptions = {
  immediate?: boolean;
};

export type ReactionClipPlaybackPhase = "fadeIn" | "playing" | "fadeOut";

export type ReactionClipPlayerSnapshot = {
  ready: boolean;
  active: boolean;
  clipId: string | null;
  ownerId: string | null;
  runId: string | null;
  sourceEventId: string | null;
  emotionEventId: string | null;
  elapsedSec: number;
  timelineDurationSec: number;
  phase: ReactionClipPlaybackPhase | null;
  fadeElapsedSec: number;
  fadeInDurationSec: number;
  fadeOutDurationSec: number;
  eventCount: number;
  eventKindCounts: AnimaPoseClipEventKindCounts;
  firedEventCount: number;
  firedEventIds: string[];
  activeEventCount: number;
  eventDispatchAvailable: boolean;
  expressionKeys: string[];
};

type ReactionClipActiveEffect = {
  event: AnimaPoseClipVFXEvent;
  context: AnimaPoseClipEventContext;
  clearAtPlaybackTime: number | null;
  /** Last envelope value sent to the sink, to skip unchanged updates. */
  intensity?: number;
};

/**
 * An Avatar Effect of a replaced Reaction, fading out over the fade-in of the
 * Reaction that replaced it before it is removed.
 */
type ReactionClipRetiringEffect = {
  event: Extract<AnimaPoseClipEvent, { kind: "avatar_vfx" }>;
  context: AnimaPoseClipEventContext;
  /** Intensity it had when its Reaction was replaced. */
  fromIntensity: number;
  elapsedSec: number;
  durationSec: number;
  easing: AnimaPoseClipEasing;
};

type ReactionClipRuntimeState = {
  clip: AnimaPoseClipV2;
  /** Samples the clip's expression lane (2.0 clips are prepared once). */
  program: AnimaPoseClipProgram;
  ownerId: string;
  runId: string;
  sourceEventId: string;
  emotionEventId: string | null;
  elapsedSec: number;
  fadeElapsedSec: number;
  phase: ReactionClipPlaybackPhase;
  fadeInDurationSec: number;
  fadeOutDurationSec: number;
  fadeInSourceSample: AnimaPoseClipSample | null;
  fadeOutSourceSample: AnimaPoseClipSample | null;
  lastExpressionSample: AnimaPoseClipSample | null;
  playbackId: number;
  firedEventKeys: Set<string>;
  firedEventIds: Set<string>;
  activeEventEffects: Map<string, ReactionClipActiveEffect>;
};

const logger = createLogger("ReactionClipPlayer");

export class ReactionClipPlayer {
  private _expressionSink: ReactionExpressionOverlaySink;
  private _eventSink: AnimaPoseClipEventSink | null;
  private _resolvePoseRef: AnimaPoseClipPoseResolver;
  private _state: ReactionClipRuntimeState | null = null;
  private _retiringEffects = new Map<string, ReactionClipRetiringEffect>();
  private _nextPlaybackId = 1;

  constructor(
    expressionSink: ReactionExpressionOverlaySink,
    options: ReactionClipPlayerOptions = {},
  ) {
    this._expressionSink = expressionSink;
    this._eventSink = options.eventSink ?? null;
    this._resolvePoseRef = options.resolvePoseRef ?? (() => null);
  }

  setEventSink(sink: AnimaPoseClipEventSink | null): void {
    this._eventSink = sink;
  }

  getSnapshot(): ReactionClipPlayerSnapshot {
    const state = this._state;
    if (!state) {
      return createReactionClipPlayerSnapshot({
        ready: true,
        eventDispatchAvailable: hasReactionClipEventSink(this._eventSink),
      });
    }

    return {
      ready: true,
      active: true,
      clipId: state.clip.id,
      ownerId: state.ownerId,
      runId: state.runId,
      sourceEventId: state.sourceEventId,
      emotionEventId: state.emotionEventId,
      elapsedSec: state.elapsedSec,
      timelineDurationSec: getAnimaPoseClipTimelineDuration(state.clip),
      phase: state.phase,
      fadeElapsedSec: state.fadeElapsedSec,
      fadeInDurationSec: state.fadeInDurationSec,
      fadeOutDurationSec: state.fadeOutDurationSec,
      eventCount: state.clip.events?.length ?? 0,
      eventKindCounts: countAnimaPoseClipEventsByKind(state.clip),
      firedEventCount: state.firedEventKeys.size,
      firedEventIds: [...state.firedEventIds].sort(),
      activeEventCount: state.activeEventEffects.size,
      eventDispatchAvailable: hasReactionClipEventSink(this._eventSink),
      expressionKeys: Object.keys(
        state.lastExpressionSample?.expressions ?? {},
      ),
    };
  }

  play(request: ReactionClipPlayRequest): boolean {
    const clip = parseAnimaPoseClip(request.clip);
    const program = createAnimaPoseClipProgram(clip, {
      resolvePose: this._resolvePoseRef,
    });
    const fadeInDurationSec = resolveAnimaPoseClipFadeDuration(
      clip.fadeIn,
      null,
    );
    // A Reaction that replaces one still showing fades in from the face that
    // one shows now, and its Avatar Effects fade out over this fade-in,
    // instead of both cutting to neutral on this frame.
    const shownSample = this._state?.lastExpressionSample ?? null;
    this._replaceState(
      fadeInDurationSec,
      resolveAnimaPoseClipFadeTransition(clip.fadeIn).easing,
    );
    this._state = {
      clip,
      program,
      ownerId: request.ownerId,
      runId: request.runId,
      sourceEventId: request.sourceEventId,
      emotionEventId: request.emotionEventId,
      elapsedSec: 0,
      fadeElapsedSec: 0,
      phase: fadeInDurationSec > 0 ? "fadeIn" : "playing",
      fadeInDurationSec,
      fadeOutDurationSec: 0,
      fadeInSourceSample: fadeInDurationSec > 0 ? (shownSample ?? {}) : null,
      fadeOutSourceSample: null,
      lastExpressionSample: null,
      playbackId: this._nextPlaybackId,
      firedEventKeys: new Set<string>(),
      firedEventIds: new Set<string>(),
      activeEventEffects: new Map<string, ReactionClipActiveEffect>(),
    };
    this._nextPlaybackId += 1;

    this._applyExpressionSampleAtTime(0);
    this._dispatchEventsBetween(0, 0, { includeStart: true });
    this._sampleEventEnvelopes(0);
    return true;
  }

  clear(
    ownerId?: string | null,
    options: ReactionClipClearOptions = {},
  ): boolean {
    const state = this._state;
    if (!state) {
      if (options.immediate === true) this._finishAllRetiringEffects();
      return false;
    }
    if (ownerId && state.ownerId !== ownerId) return false;
    if (options.immediate !== true && this._beginFadeOutIfAvailable()) {
      return false;
    }

    this._clearImmediately();
    return true;
  }

  private _clearImmediately(): void {
    const state = this._state;
    if (!state) return;

    this._clearAllEventEffects();
    this._finishAllRetiringEffects();
    this._expressionSink.clearExpressionOverlay(state.ownerId);
    this._state = null;
  }

  /**
   * End the playing Reaction for a new one with a fade-in of `durationSec`:
   * its Avatar Effects keep fading out over that time (`_updateRetiringEffects`)
   * where the sink can fade them; its other effects and its overlay go now.
   */
  private _replaceState(
    durationSec: number,
    easing: AnimaPoseClipEasing,
  ): void {
    const state = this._state;
    if (!state) return;

    const canFade =
      durationSec > 0 && Boolean(this._eventSink?.setAvatarVFXIntensity);
    // A cut ends everything at once, including any earlier crossfade.
    if (!canFade) this._finishAllRetiringEffects();
    for (const activeEffect of Array.from(state.activeEventEffects.values())) {
      const { event, context } = activeEffect;
      if (!canFade || event.kind !== "avatar_vfx") {
        this._clearEventEffect(context.appliedId);
        continue;
      }
      state.activeEventEffects.delete(context.appliedId);
      this._retiringEffects.set(context.appliedId, {
        event,
        context,
        fromIntensity: activeEffect.intensity ?? 1,
        elapsedSec: 0,
        durationSec,
        easing,
      });
    }
    this._expressionSink.clearExpressionOverlay(state.ownerId);
    this._state = null;
  }

  private _updateRetiringEffects(deltaSec: number): void {
    const handler = this._eventSink?.setAvatarVFXIntensity;
    for (const [appliedId, retiring] of Array.from(this._retiringEffects)) {
      retiring.elapsedSec += deltaSec;
      const progress = retiring.elapsedSec / retiring.durationSec;
      if (progress >= 1 || !handler) {
        this._finishRetiringEffect(appliedId);
        continue;
      }
      const { event, context } = retiring;
      const intensity =
        retiring.fromIntensity * (1 - easeProgress(progress, retiring.easing));
      this._invokeEventHandler(event, context, () =>
        handler(event, context, intensity),
      );
    }
  }

  private _finishRetiringEffect(appliedId: string): void {
    const retiring = this._retiringEffects.get(appliedId);
    if (!retiring) return;
    this._retiringEffects.delete(appliedId);
    const { event, context } = retiring;
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.clearAvatarVFX?.(event, context),
    );
  }

  private _finishAllRetiringEffects(): void {
    for (const appliedId of Array.from(this._retiringEffects.keys())) {
      this._finishRetiringEffect(appliedId);
    }
  }

  isActive(ownerId?: string): boolean {
    return Boolean(
      this._state && (!ownerId || this._state.ownerId === ownerId),
    );
  }

  update(deltaSec: number): void {
    const delta = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    this._updateRetiringEffects(delta);
    const state = this._state;
    if (!state) return;

    const previousElapsedSec = state.elapsedSec;
    const nextElapsedSec = state.elapsedSec + delta;
    state.elapsedSec = nextElapsedSec;
    if (state.phase !== "playing") {
      state.fadeElapsedSec += delta;
    }

    this._applyExpressionSampleAtTime(nextElapsedSec);
    this._clearExpiredEventEffects(nextElapsedSec);

    if (state.phase === "fadeOut") {
      this._sampleEventEnvelopes(nextElapsedSec);
      if (this._isCurrentFadeComplete(state.fadeOutDurationSec)) {
        this.clear(state.ownerId, { immediate: true });
      }
      return;
    }

    this._dispatchEventsBetween(previousElapsedSec, nextElapsedSec);
    // After dispatch, so an effect that starts this frame gets its first value.
    this._sampleEventEnvelopes(nextElapsedSec);

    if (
      state.phase === "fadeIn" &&
      this._isCurrentFadeComplete(state.fadeInDurationSec)
    ) {
      state.phase = "playing";
      state.fadeElapsedSec = 0;
      state.fadeInSourceSample = null;
    }

    if (shouldAnimaPoseClipAutoComplete(state.clip, nextElapsedSec)) {
      this.clear(state.ownerId);
    }
  }

  private _applyExpressionSampleAtTime(timeSec: number): void {
    const state = this._state;
    if (!state) return;

    const overlaySample = this._applyPlaybackEnvelope(
      this._sampleExpressionChannelsAtTime(timeSec),
    );
    state.lastExpressionSample = overlaySample;
    this._expressionSink.setExpressionOverlay(
      state.ownerId,
      overlaySample.expressions ?? {},
    );
  }

  /**
   * Reaction bindings deliberately project generic Pose Clips onto their
   * expression lane. Humanoid samples may still exist for Gesture use of the
   * same Asset, but they must never enter reaction fade/interpolation state.
   */
  private _sampleExpressionChannelsAtTime(
    timeSec: number,
  ): AnimaPoseClipSample {
    const state = this._state;
    if (!state) return { expressions: {} };

    const sample = state.program.sample(timeSec).sample;
    return { expressions: { ...(sample.expressions ?? {}) } };
  }

  private _applyPlaybackEnvelope(
    sample: AnimaPoseClipSample,
  ): AnimaPoseClipSample {
    const state = this._state;
    if (!state) return sample;

    if (state.phase === "fadeIn") {
      const transition = resolveAnimaPoseClipFadeTransition(state.clip.fadeIn);
      const progress = this._getCurrentFadeProgress(state.fadeInDurationSec);
      const sourceSample =
        state.fadeInSourceSample &&
        Object.keys(state.fadeInSourceSample.expressions ?? {}).length > 0
          ? state.fadeInSourceSample
          : createZeroExpressionSample(sample);
      return interpolateSamples(
        sourceSample,
        sample,
        progress,
        easeProgress(progress, transition.easing),
        transition,
      );
    }

    if (state.phase === "fadeOut") {
      const transition = resolveAnimaPoseClipFadeTransition(state.clip.fadeOut);
      const progress = this._getCurrentFadeProgress(state.fadeOutDurationSec);
      const sourceSample = state.fadeOutSourceSample ?? sample;
      return interpolateSamples(
        sourceSample,
        createZeroExpressionSample(sourceSample),
        progress,
        easeProgress(progress, transition.easing),
        transition,
      );
    }

    return sample;
  }

  private _beginFadeOutIfAvailable(): boolean {
    const state = this._state;
    if (!state || state.phase === "fadeOut") return false;

    const fadeOutDurationSec = resolveAnimaPoseClipFadeDuration(
      state.clip.fadeOut,
      null,
    );
    if (fadeOutDurationSec <= 0) return false;

    state.phase = "fadeOut";
    state.fadeElapsedSec = 0;
    state.fadeInSourceSample = null;
    state.fadeOutSourceSample =
      state.lastExpressionSample ??
      this._sampleExpressionChannelsAtTime(state.elapsedSec);
    state.fadeOutDurationSec = fadeOutDurationSec;
    this._applyExpressionSampleAtTime(state.elapsedSec);
    return true;
  }

  private _getCurrentFadeProgress(durationSec: number): number {
    if (durationSec <= 0) return 1;
    return Math.max(
      0,
      Math.min(1, (this._state?.fadeElapsedSec ?? 0) / durationSec),
    );
  }

  private _isCurrentFadeComplete(durationSec: number): boolean {
    return (
      durationSec <= 0 || (this._state?.fadeElapsedSec ?? 0) >= durationSec
    );
  }

  private _dispatchEventsBetween(
    fromPlaybackTimeSec: number,
    toPlaybackTimeSec: number,
    options?: { includeStart?: boolean },
  ): void {
    const state = this._state;
    if (!state) return;

    const dueEvents = collectAnimaPoseClipEventsBetween(
      state.clip,
      fromPlaybackTimeSec,
      toPlaybackTimeSec,
      options,
    );
    for (const dueEvent of dueEvents) {
      const eventKey = getDueEventKey(dueEvent);
      if (state.firedEventKeys.has(eventKey)) continue;
      state.firedEventKeys.add(eventKey);
      state.firedEventIds.add(dueEvent.event.id);
      this._dispatchEvent(dueEvent);
    }
  }

  private _dispatchEvent(dueEvent: AnimaPoseClipDueEvent): void {
    const state = this._state;
    if (!state) return;

    const event = dueEvent.event;
    const context: AnimaPoseClipEventContext = {
      clipId: state.clip.id,
      eventId: event.id,
      appliedId: getReactionClipEventAppliedId({
        runId: state.runId,
        sourceEventId: state.sourceEventId,
        emotionEventId: state.emotionEventId,
        clipId: state.clip.id,
        eventId: event.id,
        occurrenceIndex: dueEvent.occurrenceIndex,
      }),
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
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.playSfx?.(event, context),
    );
  }

  private _dispatchAvatarVFXEvent(
    event: Extract<AnimaPoseClipEvent, { kind: "avatar_vfx" }>,
    context: AnimaPoseClipEventContext,
  ): void {
    this._trackActiveEventEffect(event, context);
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.applyAvatarVFX?.(event, context),
    );
  }

  private _dispatchSceneVFXEvent(
    event: Extract<AnimaPoseClipEvent, { kind: "scene_vfx" }>,
    context: AnimaPoseClipEventContext,
  ): void {
    this._trackActiveEventEffect(event, context);
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.applySceneVFX?.(event, context),
    );
  }

  private _dispatchParticleVFXEvent(
    event: AnimaPoseClipParticleVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    this._trackActiveEventEffect(event, context);
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.applyParticleVFX?.(event, context),
    );
  }

  private _trackActiveEventEffect(
    event: AnimaPoseClipVFXEvent,
    context: AnimaPoseClipEventContext,
  ): void {
    const state = this._state;
    if (!state || !isAnimaPoseClipVFXEvent(event)) return;
    // Retire the preceding loop without reusing its asynchronous ownership ID.
    // Explicit durations keep independent occurrences for authored overlap.
    if (event.duration === undefined) {
      for (const previous of Array.from(state.activeEventEffects.values())) {
        if (
          previous.event.duration === undefined &&
          previous.context.clipId === context.clipId &&
          previous.context.eventId === context.eventId
        ) {
          this._clearEventEffect(previous.context.appliedId);
        }
      }
    }
    this._clearEventEffect(context.appliedId);
    this._finishRetiringEffect(context.appliedId);
    state.activeEventEffects.set(context.appliedId, {
      event,
      context,
      clearAtPlaybackTime:
        event.duration === undefined
          ? null
          : context.playbackTime + event.duration,
    });
  }

  /**
   * Send each fading Avatar Effect event's envelope value to the sink; while
   * the Reaction fades out, its Avatar Effects fade with its face.
   */
  private _sampleEventEnvelopes(playbackTimeSec: number): void {
    const state = this._state;
    const handler = this._eventSink?.setAvatarVFXIntensity;
    if (!state || !handler) return;
    const fadeOutScale =
      state.phase === "fadeOut"
        ? 1 -
          easeProgress(
            this._getCurrentFadeProgress(state.fadeOutDurationSec),
            resolveAnimaPoseClipFadeTransition(state.clip.fadeOut).easing,
          )
        : 1;
    for (const activeEffect of state.activeEventEffects.values()) {
      const { event, context } = activeEffect;
      if (event.kind !== "avatar_vfx") continue;
      const envelope = sampleAnimaPoseClipAvatarVFXIntensity(
        event,
        playbackTimeSec - context.playbackTime,
      );
      const intensity =
        state.phase === "fadeOut" ? (envelope ?? 1) * fadeOutScale : envelope;
      if (intensity === undefined || intensity === activeEffect.intensity) {
        continue;
      }
      activeEffect.intensity = intensity;
      handler(event, context, intensity);
    }
  }

  private _clearExpiredEventEffects(playbackTimeSec: number): void {
    const state = this._state;
    if (!state) return;

    for (const activeEffect of Array.from(state.activeEventEffects.values())) {
      if (
        activeEffect.clearAtPlaybackTime !== null &&
        activeEffect.clearAtPlaybackTime <= playbackTimeSec
      ) {
        this._clearEventEffect(activeEffect.context.appliedId);
      }
    }
  }

  private _clearAllEventEffects(): void {
    const state = this._state;
    if (!state) return;

    for (const appliedId of Array.from(state.activeEventEffects.keys())) {
      this._clearEventEffect(appliedId);
    }
  }

  private _clearEventEffect(appliedId: string): void {
    const state = this._state;
    if (!state) return;

    const activeEffect = state.activeEventEffects.get(appliedId);
    if (!activeEffect) return;
    state.activeEventEffects.delete(appliedId);

    const { event, context } = activeEffect;
    if (event.kind === "avatar_vfx") {
      this._invokeEventHandler(event, context, () =>
        this._eventSink?.clearAvatarVFX?.(event, context),
      );
      return;
    }
    if (event.kind === "particle_vfx") {
      this._invokeEventHandler(event, context, () =>
        this._eventSink?.clearParticleVFX?.(event, context),
      );
      return;
    }
    this._invokeEventHandler(event, context, () =>
      this._eventSink?.clearSceneVFX?.(event, context),
    );
  }

  private _invokeEventHandler(
    event: AnimaPoseClipEvent,
    context: AnimaPoseClipEventContext,
    run: () => void | Promise<void> | undefined,
  ): void {
    const playbackId = this._state?.playbackId ?? 0;
    try {
      void Promise.resolve(run()).catch((error) => {
        this._recordEventError(playbackId, event, context, error);
      });
    } catch (error) {
      this._recordEventError(playbackId, event, context, error);
    }
  }

  private _recordEventError(
    playbackId: number,
    event: AnimaPoseClipEvent,
    context: AnimaPoseClipEventContext,
    error: unknown,
  ): void {
    if (this._state?.playbackId !== playbackId) return;
    if (isAnimaPoseClipVFXEvent(event)) {
      this._state.activeEventEffects.delete(context.appliedId);
    }
    logger.warn("Playback", "Reaction clip event failed", {
      clipId: context.clipId,
      eventId: context.eventId,
      eventKind: event.kind,
      error,
    });
  }
}

export function getReactionClipEventAppliedId(args: {
  runId: string;
  sourceEventId: string;
  emotionEventId: string | null;
  clipId: string;
  eventId: string;
  occurrenceIndex?: number;
}): string {
  const sourceId = args.emotionEventId ?? args.sourceEventId;
  const baseId = `reaction:${args.runId}:${sourceId}:${args.clipId}:${args.eventId}`;
  return args.occurrenceIndex && args.occurrenceIndex > 0
    ? `${baseId}:${args.occurrenceIndex}`
    : baseId;
}

function getDueEventKey(dueEvent: AnimaPoseClipDueEvent): string {
  return `${dueEvent.event.id}:${dueEvent.occurrenceIndex}:${dueEvent.playbackTime}`;
}

function createZeroExpressionSample(
  sample: AnimaPoseClipSample,
): AnimaPoseClipSample {
  const expressions: Record<string, number> = {};
  for (const expressionName of Object.keys(sample.expressions ?? {})) {
    expressions[expressionName] = 0;
  }
  return Object.keys(expressions).length > 0 ? { expressions } : {};
}

function createReactionClipPlayerSnapshot(args: {
  ready: boolean;
  eventDispatchAvailable?: boolean;
}): ReactionClipPlayerSnapshot {
  return {
    ready: args.ready,
    active: false,
    clipId: null,
    ownerId: null,
    runId: null,
    sourceEventId: null,
    emotionEventId: null,
    elapsedSec: 0,
    timelineDurationSec: 0,
    phase: null,
    fadeElapsedSec: 0,
    fadeInDurationSec: 0,
    fadeOutDurationSec: 0,
    eventCount: 0,
    eventKindCounts: countAnimaPoseClipEventsByKind(null),
    firedEventCount: 0,
    firedEventIds: [],
    activeEventCount: 0,
    eventDispatchAvailable: args.eventDispatchAvailable === true,
    expressionKeys: [],
  };
}

function hasReactionClipEventSink(
  sink: AnimaPoseClipEventSink | null,
): boolean {
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
