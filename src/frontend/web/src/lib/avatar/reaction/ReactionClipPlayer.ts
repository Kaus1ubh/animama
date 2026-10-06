import { createLogger } from "@/lib/logger";
import {
  collectAnimaPoseClipEventsBetween,
  countAnimaPoseClipEventsByKind,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipVFXEvent,
  parseAnyAnimaPoseClip,
  shouldAnimaPoseClipAutoComplete,
  type AnyAnimaPoseClip,
  type AnimaPoseClipDueEvent,
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
  clip: AnyAnimaPoseClip;
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
};

type ReactionClipRuntimeState = {
  clip: AnyAnimaPoseClip;
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
    const clip = parseAnyAnimaPoseClip(request.clip);
    const program = createAnimaPoseClipProgram(clip, {
      resolvePose: this._resolvePoseRef,
    });
    this.clear(null, { immediate: true });
    const fadeInDurationSec = resolveAnimaPoseClipFadeDuration(
      clip.fadeIn,
      null,
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
      fadeInSourceSample: fadeInDurationSec > 0 ? {} : null,
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
    return true;
  }

  clear(
    ownerId?: string | null,
    options: ReactionClipClearOptions = {},
  ): boolean {
    const state = this._state;
    if (!state) return false;
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
    this._expressionSink.clearExpressionOverlay(state.ownerId);
    this._state = null;
  }

  isActive(ownerId?: string): boolean {
    return Boolean(
      this._state && (!ownerId || this._state.ownerId === ownerId),
    );
  }

  update(deltaSec: number): void {
    const state = this._state;
    if (!state) return;

    const delta = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    const previousElapsedSec = state.elapsedSec;
    const nextElapsedSec = state.elapsedSec + delta;
    state.elapsedSec = nextElapsedSec;
    if (state.phase !== "playing") {
      state.fadeElapsedSec += delta;
    }

    this._applyExpressionSampleAtTime(nextElapsedSec);
    this._clearExpiredEventEffects(nextElapsedSec);

    if (state.phase === "fadeOut") {
      if (this._isCurrentFadeComplete(state.fadeOutDurationSec)) {
        this.clear(state.ownerId, { immediate: true });
      }
      return;
    }

    this._dispatchEventsBetween(previousElapsedSec, nextElapsedSec);

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
      const transition = resolveAnimaPoseClipFadeTransition(
        state.clip,
        state.clip.fadeIn,
      );
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
      const transition = resolveAnimaPoseClipFadeTransition(
        state.clip,
        state.clip.fadeOut,
      );
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
    state.activeEventEffects.set(context.appliedId, {
      event,
      context,
      clearAtPlaybackTime:
        event.duration === undefined
          ? null
          : context.playbackTime + event.duration,
    });
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
