/**
 * Turns the lip-sync worker's plans into what the avatar and its consumers
 * read: a `vowel5` segment on the playback clock, the talking-hands timeline
 * and phrases, and tag expression overlays.
 *
 * Plans are on the run's audio clock. Playback follows it except after an
 * underrun, when the player inserts silence while the context clock runs on.
 * The player reports where playback resumed (`RunClockAnchor`), and the segment
 * closes the mouth through each gap and delays what follows.
 */

import type { FramePayload } from "@/lib/avatar/types";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import type {
  SpeechGesturePhrase,
  SpeechGestureTimeline,
} from "@/lib/speech/speech-gesture-timeline";
import type { TtsChunkRecord } from "@/lib/speech/tts-chunker";
import type { SpeechGestureTiming } from "./render/beats";
import { LIPSYNC_FPS, type LipSyncEvent } from "./track";

/** A run's full planned track, merged from incremental updates. */
export function mergePlanFrames(
  previous: Float32Array | null,
  update: { fromFrame: number; frames: Float32Array; frameCount: number },
): Float32Array {
  const merged = new Float32Array(update.frameCount * 5);
  if (previous) {
    merged.set(
      previous.subarray(0, Math.min(previous.length, update.fromFrame * 5)),
    );
  }
  merged.set(update.frames, update.fromFrame * 5);
  return merged;
}

/**
 * Where playback resumed after an underrun: run second `runSec` (of the run's
 * own audio) played at context time `contextSec`.
 */
export type RunClockAnchor = { runSec: number; contextSec: number };

/** Silence an underrun inserted: from run time `runSec`, `delaySec` long. */
export type PlaybackGap = { runSec: number; delaySec: number };

/** The gaps the anchors describe, relative to continuous playback from `audioStartSec`. */
export function playbackGaps(
  anchors: readonly RunClockAnchor[],
  audioStartSec: number,
): PlaybackGap[] {
  const gaps: PlaybackGap[] = [];
  let delay = 0;
  for (const anchor of anchors) {
    const total = anchor.contextSec - (audioStartSec + anchor.runSec);
    if (total > delay + 1e-4) {
      gaps.push({ runSec: anchor.runSec, delaySec: total - delay });
      delay = total;
    }
  }
  return gaps;
}

/** Playback time, from the audio start, of run time `runSec`. */
export function playbackTime(
  runSec: number,
  gaps: readonly PlaybackGap[],
): number {
  let time = runSec;
  for (const gap of gaps) if (gap.runSec <= runSec) time += gap.delaySec;
  return time;
}

/** Run time of playback time `playbackSec` (inside a gap: the gap's start). */
export function runTime(
  playbackSec: number,
  gaps: readonly PlaybackGap[],
): number {
  let shift = 0;
  for (const gap of gaps) {
    const start = gap.runSec + shift;
    if (playbackSec < start) break;
    if (playbackSec < start + gap.delaySec) return gap.runSec;
    shift += gap.delaySec;
  }
  return playbackSec - shift;
}

const segmentIdFor = (runId: string) => `viseme-${runId}`;

/**
 * The segment for a planned track, on the playback clock: frames at 60 FPS,
 * shifted past each gap, with the mouth closed through it.
 */
export function plannedSegment(
  runId: string,
  track: Float32Array,
  gaps: readonly PlaybackGap[] = [],
): VowelVisemeLipSyncSegment {
  const segmentId = segmentIdFor(runId);
  const count = track.length / 5;
  const frames: FramePayload[] = [];
  const closed = [0, 0, 0, 0, 0];
  let gapIndex = 0;
  let shift = 0;
  for (let index = 0; index < count; index += 1) {
    const runSec = index / LIPSYNC_FPS;
    while (gapIndex < gaps.length && gaps[gapIndex]!.runSec <= runSec) {
      const gap = gaps[gapIndex]!;
      const start = gap.runSec + shift;
      frames.push(
        {
          run_id: runId,
          segment_id: segmentId,
          time_sec: start,
          values: closed,
          format: "vowel5",
        },
        {
          run_id: runId,
          segment_id: segmentId,
          time_sec: start + Math.max(0, gap.delaySec - 1 / LIPSYNC_FPS),
          values: closed,
          format: "vowel5",
        },
      );
      shift += gap.delaySec;
      gapIndex += 1;
    }
    frames.push({
      run_id: runId,
      segment_id: segmentId,
      frame_index: index,
      time_sec: runSec + shift,
      values: Array.from(track.subarray(index * 5, index * 5 + 5)),
      format: "vowel5",
    });
  }
  const durationSec = Math.max(0, (count - 1) / LIPSYNC_FPS + shift);
  return {
    segmentId,
    meta: {
      run_id: runId,
      segment_id: segmentId,
      duration_seconds: durationSec,
      format: "vowel5",
    },
    frames,
    frameCount: frames.length,
    durationMs: Math.round(durationSec * 1000),
    durationSec,
    fps: LIPSYNC_FPS,
  };
}

/** The talking-hands timeline for a plan's gesture timing. */
export function plannedGestureTimeline(
  gestures: SpeechGestureTiming,
  durationSec: number,
  gaps: readonly PlaybackGap[] = [],
): SpeechGestureTimeline {
  const at = (sec: number) => playbackTime(sec, gaps);
  return {
    utteranceDurationSec: durationSec,
    durationSec,
    durationMs: Math.round(durationSec * 1000),
    wordTimings: gestures.words.map((word) => ({
      wordIndex: word.wordIndex,
      startSec: at(word.startSec),
      endSec: at(word.endSec),
    })),
    beats: gestures.beats.map((beat) => ({
      timeSec: at(beat.timeSec),
      wordIndex: beat.wordIndex,
      unitIndex: beat.unitIndex,
    })),
    phrases: gestures.phrases.map((phrase) => ({
      ...phrase,
      startSec: at(phrase.startSec),
      endSec: at(phrase.endSec),
    })),
    features: {
      primaryStressCount: gestures.beats.length,
      wordCount: gestures.words.length,
    },
  };
}

/**
 * Phrases as the chunk records talking hands schedule gestures by: one per
 * phrase, with its word range.
 */
export function phraseChunks(
  runId: string,
  phrases: readonly SpeechGesturePhrase[],
): TtsChunkRecord[] {
  return phrases.map((phrase, index) => ({
    runId,
    chunkId: `${runId}:phrase:${index}`,
    index,
    text: "",
    boundaryType: index === phrases.length - 1 ? "final" : "sentence",
    isExclamation: !!phrase.exclamation,
    wordCount: phrase.lastWord - phrase.firstWord + 1,
    wordStartIndex: phrase.firstWord,
    wordEndIndex: phrase.lastWord + 1,
  }));
}

/** The brief expression a tag shows while its sound plays. */
const TAG_EXPRESSIONS: Partial<Record<string, Record<string, number>>> = {
  laugh: { happy: 0.8 },
  sigh: { relaxed: 0.6 },
  gasp: { surprised: 0.7 },
};
/**
 * Overlays ramp in and out, so a tag a progressive plan shows for a moment
 * and then drops (up to 0.2 s) barely registers.
 */
const OVERLAY_ATTACK_SEC = 0.15;
const OVERLAY_RELEASE_SEC = 0.3;

/** Expression overlay weights for the tag events sounding at `runSec`. */
export function tagOverlayWeights(
  events: readonly LipSyncEvent[],
  runSec: number,
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const event of events) {
    const expressions = TAG_EXPRESSIONS[event.kind];
    if (!expressions || !event.label) continue;
    if (runSec < event.startSec || runSec > event.endSec + OVERLAY_RELEASE_SEC)
      continue;
    const rise = Math.min(1, (runSec - event.startSec) / OVERLAY_ATTACK_SEC);
    const fall =
      runSec <= event.endSec
        ? 1
        : 1 - (runSec - event.endSec) / OVERLAY_RELEASE_SEC;
    const envelope = Math.max(0, Math.min(rise, fall));
    for (const [name, weight] of Object.entries(expressions)) {
      weights[name] = Math.max(weights[name] ?? 0, weight * envelope);
    }
  }
  return weights;
}
