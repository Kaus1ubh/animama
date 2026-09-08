import { MathUtils } from "three";

import type { AvatarInteractionPhase } from "@/lib/types/voice-types";
import type { AvatarAnimationState } from "../../types";
import {
  ANIMA_POSE_CLIP_EPSILON,
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  parseAnimaPoseClip,
  type AnimaPoseClip,
  type AnimaPoseClipFade,
  type AnimaPoseClipPlayback,
  type AnimaPoseClipPlaybackLifetime,
  type ResolvedAnimaPoseClipTransition,
} from "./schema";

export type AnimaPoseClipPlaybackFacts = {
  interactionPhase: AvatarInteractionPhase;
  avatarState: AvatarAnimationState;
  activeRunId: string | null;
  ownerRunId: string | null;
};

/**
 * Returns the authored timeline extent, excluding VFX durations because those
 * describe effect lifetime rather than pose/expression timeline length.
 */
export function getAnimaPoseClipTimelineDuration(clip: AnimaPoseClip): number {
  const sanitizedClip = parseAnimaPoseClip(clip);
  if (
    typeof sanitizedClip.duration === "number" &&
    Number.isFinite(sanitizedClip.duration)
  ) {
    return Math.max(0, sanitizedClip.duration);
  }

  let maxTime = 0;
  for (const keyframe of sanitizedClip.poseKeyframes) {
    maxTime = Math.max(maxTime, keyframe.time);
  }
  for (const event of sanitizedClip.events ?? []) {
    maxTime = Math.max(maxTime, event.time);
  }
  return maxTime;
}

export function getAnimaPoseClipSampleTime(
  clip: AnimaPoseClip,
  playbackTimeSec: number,
): number {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const time = Number.isFinite(playbackTimeSec)
    ? Math.max(playbackTimeSec, 0)
    : 0;
  const timelineDuration = getAnimaPoseClipTimelineDuration(sanitizedClip);

  if (sanitizedClip.loop === true && timelineDuration > 0) {
    return ((time % timelineDuration) + timelineDuration) % timelineDuration;
  }
  return MathUtils.clamp(time, 0, timelineDuration);
}

export function shouldAnimaPoseClipAutoComplete(
  clip: AnimaPoseClip,
  playbackTimeSec: number,
): boolean {
  const sanitizedClip = parseAnimaPoseClip(clip);
  if (sanitizedClip.loop === true || sanitizedClip.playback) return false;
  return (
    playbackTimeSec >=
    getAnimaPoseClipTimelineDuration(sanitizedClip) - ANIMA_POSE_CLIP_EPSILON
  );
}

export function getAnimaPoseClipFadeDuration(
  fade: AnimaPoseClipFade | undefined,
): number {
  if (!fade || !Number.isFinite(fade.duration)) return 0;
  return Math.max(0, fade.duration);
}

export function resolveAnimaPoseClipFadeDuration(
  fade: AnimaPoseClipFade | undefined,
  overrideDurationSec: number | null | undefined,
): number {
  if (
    typeof overrideDurationSec === "number" &&
    Number.isFinite(overrideDurationSec)
  ) {
    return Math.max(0, overrideDurationSec);
  }
  return getAnimaPoseClipFadeDuration(fade);
}

export function resolveAnimaPoseClipFadeTransition(
  clip: AnimaPoseClip,
  fade: AnimaPoseClipFade | undefined,
): ResolvedAnimaPoseClipTransition {
  return {
    easing:
      fade?.easing ??
      clip.defaultTransition?.easing ??
      DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing,
    interpolation: {
      humanoidRotation:
        fade?.interpolation?.humanoidRotation ??
        clip.defaultTransition?.interpolation?.humanoidRotation ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.humanoidRotation,
      humanoidPosition:
        fade?.interpolation?.humanoidPosition ??
        clip.defaultTransition?.interpolation?.humanoidPosition ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.humanoidPosition,
      expression:
        fade?.interpolation?.expression ??
        clip.defaultTransition?.interpolation?.expression ??
        DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation.expression,
    },
  };
}

export function isAnimaPoseClipPlaybackLifetimeActive(
  playback: AnimaPoseClipPlayback | AnimaPoseClipPlaybackLifetime | undefined,
  facts: AnimaPoseClipPlaybackFacts,
): boolean {
  if (!playback) return true;
  const lifetime = "lifetime" in playback ? playback.lifetime : playback;

  if (
    lifetime.scope === "activeRun" &&
    (!facts.ownerRunId || facts.activeRunId !== facts.ownerRunId)
  ) {
    return false;
  }

  if (lifetime.kind === "whileInteractionPhase") {
    if (
      facts.interactionPhase === "responding_no_tts" &&
      lifetime.phases.includes("talking")
    ) {
      return true;
    }
    return lifetime.phases.includes(facts.interactionPhase);
  }
  return lifetime.states.includes(facts.avatarState);
}
