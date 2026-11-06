import type { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";

/*
 * Clip playback rules shared by the reel recorder (`reel.ts`) and the live
 * combo page (`../animation-combo/combo.ts`).
 */

/**
 * When to stop a clip that does not end by itself, in seconds after it
 * starts: a talking-scoped clip after `talk` seconds and its timed events, a
 * loop after one pass; null for a clip that completes on its own.
 */
export function stopAfter(
  clip: ReturnType<typeof parseAnimaPoseClip>,
  talk: number,
): number | null {
  if (clip.playback) {
    const eventsEnd = Math.max(
      0,
      ...(clip.events ?? []).map(
        (event) =>
          event.time + ("duration" in event ? (event.duration ?? 0) : 0),
      ),
    );
    return Math.max(talk, clip.duration, eventsEnd);
  }
  return clip.loop === true ? clip.duration : null;
}
