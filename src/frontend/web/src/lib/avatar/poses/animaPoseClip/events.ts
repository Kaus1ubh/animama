import { MathUtils } from "three";

import { easeProgress } from "./interpolation";
import { getAnimaPoseClipTimelineDuration } from "./playback";
import {
  ANIMA_POSE_CLIP_EPSILON,
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  parseAnimaPoseClip,
  type AnimaPoseClip,
  type AnimaPoseClipEvent,
  type AnimaPoseClipScalarInterpolation,
  type AnimaPoseClipTransition,
  type AnimaPoseClipVFXEvent,
  type AnimaPoseClipVFXParameterKeyframe,
} from "./schema";

export type AnimaPoseClipEventCollectionOptions = {
  includeStart?: boolean;
};

export type AnimaPoseClipDueEvent = {
  event: AnimaPoseClipEvent;
  playbackTime: number;
  clipTime: number;
  occurrenceIndex: number;
};

export type AnimaPoseClipVFXEventState = {
  active: boolean;
  intensity?: number;
  parameters: Record<string, number>;
};

export type AnimaPoseClipActiveVFXEvent = {
  event: AnimaPoseClipVFXEvent;
  playbackStartTime: number;
  localTime: number;
  occurrenceIndex: number;
  state: AnimaPoseClipVFXEventState;
};

export type AnimaPoseClipCatalogIdCollection =
  | ReadonlySet<string>
  | readonly string[];

export type AnimaPoseClipEventCatalogRefs = {
  avatarVFXIds?: AnimaPoseClipCatalogIdCollection;
  sceneBackgroundLayerPresetIds?: AnimaPoseClipCatalogIdCollection;
  sceneFocusLinePresetIds?: AnimaPoseClipCatalogIdCollection;
  particleVFXIds?: AnimaPoseClipCatalogIdCollection;
  sfxCueIds?: AnimaPoseClipCatalogIdCollection;
};

export type AnimaPoseClipEventCatalogRefDiagnostics = {
  missingAvatarVFXIds: string[];
  missingSceneBackgroundLayerPresetIds: string[];
  missingSceneFocusLinePresetIds: string[];
  missingParticleVFXIds: string[];
  missingSFXCueIds: string[];
};

export type AnimaPoseClipEventKindCounts = {
  total: number;
  avatarVFX: number;
  sceneVFX: number;
  sceneBackground: number;
  sceneFocus: number;
  particleVFX: number;
  sfx: number;
};

type IndexedDueEvent = AnimaPoseClipDueEvent & {
  eventIndex: number;
};

type IndexedActiveVFXEvent = AnimaPoseClipActiveVFXEvent & {
  eventIndex: number;
};

/**
 * Returns clip events that should fire while playback advances from one
 * absolute playback time to another. The lower bound is exclusive by default
 * so a caller can poll frame-to-frame without re-firing boundary events.
 */
export function collectAnimaPoseClipEventsBetween(
  clip: AnimaPoseClip,
  fromPlaybackTimeSec: number,
  toPlaybackTimeSec: number,
  options: AnimaPoseClipEventCollectionOptions = {},
): AnimaPoseClipDueEvent[] {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const events = sanitizedClip.events ?? [];
  if (events.length === 0) return [];

  const fromTime = normalizePlaybackTime(fromPlaybackTimeSec);
  const toTime = normalizePlaybackTime(toPlaybackTimeSec);
  if (toTime < fromTime) return [];

  const dueEvents =
    sanitizedClip.loop === true
      ? collectLoopingEventsBetween(sanitizedClip, fromTime, toTime, options)
      : collectNonLoopingEventsBetween(
          sanitizedClip,
          fromTime,
          toTime,
          options,
        );

  return dueEvents.map(
    ({ event, playbackTime, clipTime, occurrenceIndex }) => ({
      event,
      playbackTime,
      clipTime,
      occurrenceIndex,
    }),
  );
}

/**
 * Samples VFX events that are active at a single playback time. This is for
 * preview/scrubbing state and intentionally never returns one-shot SFX events.
 */
export function sampleAnimaPoseClipActiveEventsAtTime(
  clip: AnimaPoseClip,
  playbackTimeSec: number,
): AnimaPoseClipActiveVFXEvent[] {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const events = sanitizedClip.events ?? [];
  if (events.length === 0) return [];

  const playbackTime = normalizePlaybackTime(playbackTimeSec);
  const activeEvents =
    sanitizedClip.loop === true
      ? sampleLoopingActiveVFXEventsAtTime(sanitizedClip, playbackTime)
      : sampleNonLoopingActiveVFXEventsAtTime(sanitizedClip, playbackTime);

  return activeEvents.map(
    ({ event, playbackStartTime, localTime, occurrenceIndex, state }) => ({
      event,
      playbackStartTime,
      localTime,
      occurrenceIndex,
      state,
    }),
  );
}

/**
 * Resolves a VFX event's local-time state into data the runtime can consume:
 * lifecycle activity, optional intensity override, and numeric parameters.
 */
export function sampleAnimaPoseClipVFXEventState(
  event: AnimaPoseClipVFXEvent,
  localTimeSec: number,
): AnimaPoseClipVFXEventState {
  const localTime = Number.isFinite(localTimeSec) ? localTimeSec : 0;
  const active = isStateActiveAtLocalTime(event, localTime);
  if (!active) {
    return {
      active: false,
      parameters: {},
    };
  }

  const clampedLocalTime =
    event.duration === undefined
      ? Math.max(localTime, 0)
      : MathUtils.clamp(localTime, 0, event.duration);
  const intensity = sampleVFXIntensity(event, clampedLocalTime);

  return {
    active: true,
    ...(intensity !== undefined ? { intensity } : {}),
    parameters: sampleVFXParameters(event.parameterKeyframes, clampedLocalTime),
  };
}

/**
 * Checks event catalog ids without coupling the clip schema package to avatar
 * VFX, scene VFX, or sound runtime modules.
 */
export function validateAnimaPoseClipEventCatalogRefs(
  clip: AnimaPoseClip,
  catalogs: AnimaPoseClipEventCatalogRefs,
): AnimaPoseClipEventCatalogRefDiagnostics {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const diagnostics: AnimaPoseClipEventCatalogRefDiagnostics = {
    missingAvatarVFXIds: [],
    missingSceneBackgroundLayerPresetIds: [],
    missingSceneFocusLinePresetIds: [],
    missingParticleVFXIds: [],
    missingSFXCueIds: [],
  };

  for (const event of sanitizedClip.events ?? []) {
    if (
      event.kind === "avatar_vfx" &&
      !hasCatalogId(catalogs.avatarVFXIds, event.effectId)
    ) {
      addMissingId(diagnostics.missingAvatarVFXIds, event.effectId);
    } else if (
      event.kind === "scene_vfx" &&
      event.sceneKind === "background_layers" &&
      !hasCatalogId(catalogs.sceneBackgroundLayerPresetIds, event.presetId)
    ) {
      addMissingId(
        diagnostics.missingSceneBackgroundLayerPresetIds,
        event.presetId,
      );
    } else if (
      event.kind === "scene_vfx" &&
      event.sceneKind === "focus_lines" &&
      !hasCatalogId(catalogs.sceneFocusLinePresetIds, event.presetId)
    ) {
      addMissingId(diagnostics.missingSceneFocusLinePresetIds, event.presetId);
    } else if (
      event.kind === "particle_vfx" &&
      !hasCatalogId(catalogs.particleVFXIds, event.effectId)
    ) {
      addMissingId(diagnostics.missingParticleVFXIds, event.effectId);
    } else if (
      event.kind === "sfx" &&
      !hasCatalogId(catalogs.sfxCueIds, event.cueId)
    ) {
      addMissingId(diagnostics.missingSFXCueIds, event.cueId);
    }
  }

  return diagnostics;
}

export function countAnimaPoseClipEventsByKind(
  clip: Pick<AnimaPoseClip, "events"> | null | undefined,
): AnimaPoseClipEventKindCounts {
  const counts: AnimaPoseClipEventKindCounts = {
    total: 0,
    avatarVFX: 0,
    sceneVFX: 0,
    sceneBackground: 0,
    sceneFocus: 0,
    particleVFX: 0,
    sfx: 0,
  };

  for (const event of clip?.events ?? []) {
    counts.total += 1;
    if (event.kind === "avatar_vfx") {
      counts.avatarVFX += 1;
    } else if (event.kind === "scene_vfx") {
      counts.sceneVFX += 1;
      if (event.sceneKind === "background_layers") {
        counts.sceneBackground += 1;
      } else {
        counts.sceneFocus += 1;
      }
    } else if (event.kind === "particle_vfx") {
      counts.particleVFX += 1;
    } else {
      counts.sfx += 1;
    }
  }

  return counts;
}

/**
 * Narrows a generic clip event to the VFX events that can have duration,
 * envelope, and parameter animation state.
 */
export function isAnimaPoseClipVFXEvent(
  event: AnimaPoseClipEvent,
): event is AnimaPoseClipVFXEvent {
  return (
    event.kind === "avatar_vfx" ||
    event.kind === "scene_vfx" ||
    event.kind === "particle_vfx"
  );
}

/**
 * Collects events in a clamped non-looping playback window. Event array order
 * is preserved for multiple events at the same timestamp.
 */
function collectNonLoopingEventsBetween(
  clip: AnimaPoseClip,
  fromTime: number,
  toTime: number,
  options: AnimaPoseClipEventCollectionOptions,
): IndexedDueEvent[] {
  const timelineDuration = getAnimaPoseClipTimelineDuration(clip);
  const start = MathUtils.clamp(fromTime, 0, timelineDuration);
  const end = MathUtils.clamp(toTime, 0, timelineDuration);
  if (end < start) return [];

  return (clip.events ?? []).flatMap((event, eventIndex) =>
    isTimeInWindow(event.time, start, end, options.includeStart === true)
      ? [
          {
            event,
            eventIndex,
            playbackTime: event.time,
            clipTime: event.time,
            occurrenceIndex: 0,
          },
        ]
      : [],
  );
}

/**
 * Collects events across looping playback by expanding each event into its
 * absolute playback occurrence, then sorting by time and original array order.
 */
function collectLoopingEventsBetween(
  clip: AnimaPoseClip,
  fromTime: number,
  toTime: number,
  options: AnimaPoseClipEventCollectionOptions,
): IndexedDueEvent[] {
  const dueEvents: IndexedDueEvent[] = [];
  const includeStart = options.includeStart === true;
  const timelineDuration = getAnimaPoseClipTimelineDuration(clip);
  if (timelineDuration <= 0) return [];

  for (const [eventIndex, event] of (clip.events ?? []).entries()) {
    const firstOccurrenceIndex = Math.max(
      0,
      Math.ceil((fromTime - event.time) / timelineDuration),
    );
    const lastOccurrenceIndex = Math.floor(
      (toTime - event.time) / timelineDuration,
    );

    for (
      let occurrenceIndex = firstOccurrenceIndex;
      occurrenceIndex <= lastOccurrenceIndex;
      occurrenceIndex += 1
    ) {
      const playbackTime = event.time + occurrenceIndex * timelineDuration;
      if (!isTimeInWindow(playbackTime, fromTime, toTime, includeStart)) {
        continue;
      }

      dueEvents.push({
        event,
        eventIndex,
        playbackTime,
        clipTime: event.time,
        occurrenceIndex,
      });
    }
  }

  return dueEvents.sort(compareIndexedDueEvents);
}

/**
 * Computes active VFX intervals for non-looping preview. No-duration VFX stay
 * active after their trigger, matching runtime clip-owned VFX lifecycle.
 */
function sampleNonLoopingActiveVFXEventsAtTime(
  clip: AnimaPoseClip,
  playbackTime: number,
): IndexedActiveVFXEvent[] {
  const clipTime = MathUtils.clamp(
    playbackTime,
    0,
    getAnimaPoseClipTimelineDuration(clip),
  );

  return (clip.events ?? []).flatMap((event, eventIndex) => {
    if (!isAnimaPoseClipVFXEvent(event)) return [];

    const localTime = clipTime - event.time;
    if (!isStateActiveAtLocalTime(event, localTime)) return [];

    return [
      {
        event,
        eventIndex,
        playbackStartTime: event.time,
        localTime: Math.max(localTime, 0),
        occurrenceIndex: 0,
        state: sampleAnimaPoseClipVFXEventState(event, localTime),
      },
    ];
  });
}

/**
 * Computes active VFX intervals for looping preview by considering every
 * occurrence that could overlap the sampled absolute playback time.
 */
function sampleLoopingActiveVFXEventsAtTime(
  clip: AnimaPoseClip,
  playbackTime: number,
): IndexedActiveVFXEvent[] {
  const activeEvents: IndexedActiveVFXEvent[] = [];
  const timelineDuration = getAnimaPoseClipTimelineDuration(clip);
  if (timelineDuration <= 0) return activeEvents;

  for (const [eventIndex, event] of (clip.events ?? []).entries()) {
    if (!isAnimaPoseClipVFXEvent(event)) continue;

    const activeDuration = event.duration ?? 0;
    const firstOccurrenceIndex = Math.max(
      0,
      Math.ceil(
        (playbackTime - event.time - activeDuration) / timelineDuration,
      ),
    );
    const lastOccurrenceIndex = Math.floor(
      (playbackTime - event.time) / timelineDuration,
    );

    for (
      let occurrenceIndex = firstOccurrenceIndex;
      occurrenceIndex <= lastOccurrenceIndex;
      occurrenceIndex += 1
    ) {
      const playbackStartTime = event.time + occurrenceIndex * timelineDuration;
      const localTime = playbackTime - playbackStartTime;
      if (!isVFXEventActiveForScrub(event, localTime)) continue;

      activeEvents.push({
        event,
        eventIndex,
        playbackStartTime,
        localTime: Math.max(localTime, 0),
        occurrenceIndex,
        state: sampleAnimaPoseClipVFXEventState(event, localTime),
      });
    }
  }

  return activeEvents.sort(compareIndexedActiveEvents);
}

/**
 * Samples the common intensity envelope. If fade-in and fade-out overlap, the
 * fades are scaled to fit the event duration deterministically.
 */
function sampleVFXIntensity(
  event: AnimaPoseClipVFXEvent,
  localTime: number,
): number | undefined {
  const intensity = event.envelope?.intensity;
  if (!intensity) return undefined;

  const from = intensity.from ?? 0;
  const to = intensity.to ?? 1;
  const easing = intensity.easing ?? DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing;
  const fadeIn = intensity.fadeIn ?? 0;

  if (event.duration === undefined) {
    if (fadeIn <= ANIMA_POSE_CLIP_EPSILON) return to;
    const progress = MathUtils.clamp(localTime / fadeIn, 0, 1);
    return MathUtils.lerp(from, to, easeProgress(progress, easing));
  }

  const { fadeIn: effectiveFadeIn, fadeOut: effectiveFadeOut } =
    normalizeFadeDurations(fadeIn, intensity.fadeOut ?? 0, event.duration);

  if (
    effectiveFadeIn > ANIMA_POSE_CLIP_EPSILON &&
    localTime < effectiveFadeIn
  ) {
    const progress = MathUtils.clamp(localTime / effectiveFadeIn, 0, 1);
    return MathUtils.lerp(from, to, easeProgress(progress, easing));
  }

  const fadeOutStart = event.duration - effectiveFadeOut;
  if (effectiveFadeOut > ANIMA_POSE_CLIP_EPSILON && localTime > fadeOutStart) {
    const progress = MathUtils.clamp(
      (localTime - fadeOutStart) / effectiveFadeOut,
      0,
      1,
    );
    return MathUtils.lerp(to, from, easeProgress(progress, easing));
  }

  return to;
}

/**
 * Samples generic numeric VFX parameters using the same easing vocabulary as
 * pose clips. The schema requires matching keys across parameter keyframes.
 */
function sampleVFXParameters(
  keyframes: AnimaPoseClipVFXParameterKeyframe[] | undefined,
  localTime: number,
): Record<string, number> {
  if (!keyframes || keyframes.length === 0) return {};
  if (localTime <= keyframes[0].time)
    return cloneParameters(keyframes[0].values);

  const lastKeyframe = keyframes[keyframes.length - 1];
  if (localTime >= lastKeyframe.time) {
    return cloneParameters(lastKeyframe.values);
  }

  const nextIndex = keyframes.findIndex(
    (keyframe) => keyframe.time >= localTime,
  );
  const fromKeyframe = keyframes[nextIndex - 1];
  const toKeyframe = keyframes[nextIndex];
  const duration = toKeyframe.time - fromKeyframe.time;
  const segmentProgress =
    duration > ANIMA_POSE_CLIP_EPSILON
      ? MathUtils.clamp((localTime - fromKeyframe.time) / duration, 0, 1)
      : 1;
  const transition = resolveParameterTransition(toKeyframe.transition);
  const easedProgress = easeProgress(segmentProgress, transition.easing);
  const parameters: Record<string, number> = {};

  for (const key of Object.keys(fromKeyframe.values)) {
    parameters[key] = interpolateParameterValue(
      fromKeyframe.values[key],
      toKeyframe.values[key],
      segmentProgress,
      easedProgress,
      transition.interpolation,
    );
  }

  return parameters;
}

/**
 * Maps a generic pose-clip transition onto scalar VFX parameter interpolation.
 */
function resolveParameterTransition(transition: AnimaPoseClipTransition = {}): {
  easing: typeof DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing;
  interpolation: AnimaPoseClipScalarInterpolation;
} {
  return {
    easing: transition.easing ?? DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing,
    interpolation:
      transition.interpolation?.expression ??
      DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.expression,
  };
}

/**
 * Interpolates one numeric parameter, preserving step transitions when chosen.
 */
function interpolateParameterValue(
  fromValue: number,
  toValue: number,
  segmentProgress: number,
  easedProgress: number,
  interpolation: AnimaPoseClipScalarInterpolation,
): number {
  if (interpolation === "step") {
    return segmentProgress >= 1 ? toValue : fromValue;
  }
  return MathUtils.lerp(fromValue, toValue, easedProgress);
}

/**
 * Preserves fade proportions when an author asks for more fade time than the
 * event duration can contain.
 */
function normalizeFadeDurations(
  fadeIn: number,
  fadeOut: number,
  duration: number,
): { fadeIn: number; fadeOut: number } {
  if (fadeIn + fadeOut <= duration || fadeIn + fadeOut <= 0) {
    return { fadeIn, fadeOut };
  }

  const scale = duration / (fadeIn + fadeOut);
  return {
    fadeIn: fadeIn * scale,
    fadeOut: fadeOut * scale,
  };
}

/**
 * Tests whether a local event time is inside the VFX event lifecycle.
 */
function isStateActiveAtLocalTime(
  event: AnimaPoseClipVFXEvent,
  localTime: number,
): boolean {
  return (
    localTime >= -ANIMA_POSE_CLIP_EPSILON &&
    (event.duration === undefined ||
      localTime <= event.duration + ANIMA_POSE_CLIP_EPSILON)
  );
}

/**
 * Applies the scrub-preview rule for VFX with no explicit duration: show only
 * at the event trigger instant instead of treating it as infinitely active.
 */
function isVFXEventActiveForScrub(
  event: AnimaPoseClipVFXEvent,
  localTime: number,
): boolean {
  if (event.duration === undefined) {
    return Math.abs(localTime) <= ANIMA_POSE_CLIP_EPSILON;
  }
  return isStateActiveAtLocalTime(event, localTime);
}

/**
 * Centralizes the event-window boundary rule: lower-exclusive during normal
 * polling, lower-inclusive when starting playback or explicitly requested.
 */
function isTimeInWindow(
  time: number,
  start: number,
  end: number,
  includeStart: boolean,
): boolean {
  const afterStart = includeStart
    ? time >= start - ANIMA_POSE_CLIP_EPSILON
    : time > start + ANIMA_POSE_CLIP_EPSILON;
  return afterStart && time <= end + ANIMA_POSE_CLIP_EPSILON;
}

function normalizePlaybackTime(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function cloneParameters(
  values: Record<string, number>,
): Record<string, number> {
  return { ...values };
}

function hasCatalogId(
  source: AnimaPoseClipCatalogIdCollection | undefined,
  id: string,
): boolean {
  if (!source) return true;
  if (Array.isArray(source)) return source.includes(id);
  return (source as ReadonlySet<string>).has(id);
}

function addMissingId(ids: string[], id: string): void {
  if (!ids.includes(id)) {
    ids.push(id);
  }
}

function compareIndexedDueEvents(
  left: IndexedDueEvent,
  right: IndexedDueEvent,
): number {
  return (
    left.playbackTime - right.playbackTime || left.eventIndex - right.eventIndex
  );
}

function compareIndexedActiveEvents(
  left: IndexedActiveVFXEvent,
  right: IndexedActiveVFXEvent,
): number {
  return (
    left.playbackStartTime - right.playbackStartTime ||
    left.eventIndex - right.eventIndex
  );
}
