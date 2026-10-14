/**
 * When a reply's words are spoken and where talking hands may beat, on the
 * run's audio clock (seconds from its first sample). The lip-sync planner
 * produces it; talking hands and the desktop picture-in-picture read it.
 */

export type SpeechGestureBeat = {
  timeSec: number;
  wordIndex: number;
  /** The beat syllable's position in its plan, which orders beats at one time. */
  unitIndex: number;
};

export type SpeechGestureWordTiming = {
  wordIndex: number;
  startSec: number;
  endSec: number;
};

/** Words spoken between pauses, stops and tags: the span a gesture can cover. */
export type SpeechGesturePhrase = {
  startSec: number;
  endSec: number;
  firstWord: number;
  lastWord: number;
  /** The phrase ends with an exclamation mark; hands use both arms. */
  exclamation?: boolean;
};

export type SpeechGestureTimeline = {
  utteranceDurationSec: number;
  durationSec: number;
  durationMs: number;
  wordTimings: SpeechGestureWordTiming[];
  beats: SpeechGestureBeat[];
  /** Present when the planner knows the phrases (the audio-aligned planner). */
  phrases?: SpeechGesturePhrase[];
  features: {
    beatCount: number;
    wordCount: number;
  };
};
