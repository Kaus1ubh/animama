/**
 * Lip-sync units: what the planner expects to hear, in order, built from the
 * spoken text. The aligner places them on the audio and the renderer turns
 * them into mouth shapes.
 */

import type { LipSyncVowel } from "@/lib/lipsync/track";

export type LipSyncUnitKind =
  /** A syllable with a known vowel shape. */
  | "syllable"
  /** A syllable whose vowel is unknown, such as a kanji without a reading. */
  | "unknown"
  /** Lips together: m, b, p. */
  | "closure"
  /** A nasal coda such as n or ng; the mouth nearly closes. */
  | "nasal"
  /** A possible pause at punctuation. */
  | "pause"
  /** A vocal tag performed as a sound or a silence. */
  | "tag";

/**
 * How a tag affects the mouth:
 *
 * - `laugh`, `sigh`, `gasp`: a vocal sound with its own mouth shape and expression;
 * - `vocal`: another vocal sound (cough, cry, groan), following loudness;
 * - `pause`: silence;
 * - `sound_effect`: a sound that is not the voice; the mouth rests;
 * - `whisper`: narrower shapes for the words after it;
 * - `delivery`: an emotion or delivery direction that leaves the mouth alone.
 */
export type LipSyncTagKind =
  | "laugh"
  | "sigh"
  | "gasp"
  | "vocal"
  | "pause"
  | "sound_effect"
  | "whisper"
  | "delivery";

export type LipSyncUnit = {
  kind: LipSyncUnitKind;
  vowel?: LipSyncVowel;
  /**
   * Expected length: in syllables for speech units (a long vowel or a heavy
   * syllable counts more), in seconds for pauses and tags.
   */
  weight: number;
  /** Source text range `[start, end)` in the planned text. */
  start: number;
  end: number;
  /** The word the unit belongs to, for speech units; words count from 0 per text. */
  word?: number;
  /** A primary-stressed syllable, when the text says so (English). */
  stressed?: boolean;
  /** Spoken in a whisper: narrower shapes. */
  whisper?: boolean;
  /** For tags: what kind, and the tag as written, such as `[laughs]`. */
  tag?: { kind: LipSyncTagKind; label: string };
  /** For pauses: a sentence stop or a lighter break such as a comma. */
  pause?: "stop" | "break";
};
