import {
  sampleAnimaPoseClipActiveEventsAtTime,
  type AnimaPoseClipV2,
  type AnimaPoseClipActiveVFXEvent,
} from "@/lib/avatar";

const PLAYBACK_BOUNDARY_EPSILON_SEC = 1e-6;

/**
 * Restore effects that began before a resumed playhead. Effects beginning on
 * the playhead are owned by due-event dispatch so async VFX never starts twice.
 */
export function activeVFXEventsBeforePlaybackStart(
  clip: AnimaPoseClipV2,
  playbackTimeSec: number,
): AnimaPoseClipActiveVFXEvent[] {
  return sampleAnimaPoseClipActiveEventsAtTime(clip, playbackTimeSec).filter(
    (activeEvent) =>
      activeEvent.playbackStartTime <
      playbackTimeSec - PLAYBACK_BOUNDARY_EPSILON_SEC,
  );
}

/**
 * Sample the stateful effects that can be represented at a stationary
 * playhead. Particle emitters are intentionally excluded: the current particle
 * runtime advances in wall-clock time and cannot seek to a deterministic
 * local-time snapshot, so replaying it on every scrub movement is misleading.
 */
export function samplePoseCreatorScrubVFXEvents(
  clip: AnimaPoseClipV2,
  playbackTimeSec: number,
): AnimaPoseClipActiveVFXEvent[] {
  return sampleAnimaPoseClipActiveEventsAtTime(clip, playbackTimeSec).filter(
    (activeEvent) => activeEvent.event.kind !== "particle_vfx",
  );
}

/** Stable identity for deciding whether a scrubbed VFX state needs remounting. */
export function poseCreatorScrubVFXSignature(
  clip: AnimaPoseClipV2,
  activeEvents: readonly AnimaPoseClipActiveVFXEvent[],
  catalogRevision: string | null,
): string {
  return JSON.stringify({
    clipId: clip.id,
    catalogRevision,
    active: activeEvents.map((activeEvent) => ({
      event: activeEvent.event,
      occurrenceIndex: activeEvent.occurrenceIndex,
    })),
  });
}
