/**
 * Gesture timing from aligned units: when each word is spoken, the beats that
 * talking hands can land on, and the phrases between pauses.
 *
 * A beat falls on a prominent syllable: louder, higher-pitched or longer than
 * its neighbours, which works in any language. Where the text marks stress
 * (English), it tips the balance between syllables that are close. Beats are at
 * least 0.4 s apart, the strongest kept first. Tags, pauses and weak vowels
 * never carry a beat. Without audio, prominence comes from stress and length
 * alone, for provisional beats.
 */

import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import type { AlignedUnit } from "@/lib/lipsync/align/aligner";

const MIN_BEAT_SPACING_SEC = 0.4;
/** A pause at least this long, or any sentence stop, ends a phrase. */
const PHRASE_BREAK_SEC = 0.15;
/** Neighbours on each side a syllable is compared with. */
const NEIGHBOURS = 2;
const STRESS_BONUS = 0.3;
/** Voicing above which a frame's pitch is trusted. */
const VOICED = 0.5;

export type SpeechBeat = {
  timeSec: number;
  wordIndex: number;
  /** The syllable's index in the aligned units. */
  unitIndex: number;
  /** How much the syllable stands out from its neighbours. */
  strength: number;
};

export type SpeechWordTiming = {
  wordIndex: number;
  startSec: number;
  endSec: number;
};

export type SpeechPhrase = {
  startSec: number;
  endSec: number;
  firstWord: number;
  lastWord: number;
};

export type SpeechGestureTiming = {
  words: SpeechWordTiming[];
  beats: SpeechBeat[];
  phrases: SpeechPhrase[];
};

type Syllable = {
  unitIndex: number;
  wordIndex: number;
  /** When the syllable is loudest, or its middle. */
  peakSec: number;
  loudnessDb: number;
  /** Semitones above the reply's median pitch, 0 when unvoiced. */
  pitchSt: number;
  lengthSec: number;
  stressed: boolean;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureSyllables(
  aligned: readonly AlignedUnit[],
  features: SpeechFeatures | null,
): Syllable[] {
  const voicedPitch: number[] = [];
  if (features) {
    for (let t = 0; t < features.pitchHz.length; t += 1) {
      if (features.voicing[t]! > VOICED) voicedPitch.push(features.pitchHz[t]!);
    }
  }
  const medianPitch = median(voicedPitch);
  const out: Syllable[] = [];
  aligned.forEach(({ unit, startSec, endSec }, unitIndex) => {
    if (unit.kind !== "syllable" && unit.kind !== "unknown") return;
    if (unit.weak || unit.word === undefined || endSec <= startSec) return;
    const syllable: Syllable = {
      unitIndex,
      wordIndex: unit.word,
      peakSec: (startSec + endSec) / 2,
      loudnessDb: 0,
      pitchSt: 0,
      lengthSec: endSec - startSec,
      stressed: !!unit.stressed,
    };
    if (features) {
      const first = Math.max(0, Math.floor(startSec * features.rate));
      const end = Math.min(
        features.loudnessDb.length,
        Math.max(first + 1, Math.ceil(endSec * features.rate)),
      );
      let loudest = -Infinity;
      let highest = 0;
      for (let t = first; t < end; t += 1) {
        if (features.loudnessDb[t]! > loudest) {
          loudest = features.loudnessDb[t]!;
          syllable.peakSec = t / features.rate;
        }
        if (features.voicing[t]! > VOICED) {
          highest = Math.max(highest, features.pitchHz[t]!);
        }
      }
      if (Number.isFinite(loudest)) syllable.loudnessDb = loudest;
      if (highest > 0 && medianPitch > 0) {
        syllable.pitchSt = 12 * Math.log2(highest / medianPitch);
      }
    }
    out.push(syllable);
  });
  return out;
}

/** How much each syllable stands out from its neighbours. */
function prominence(syllables: Syllable[], withAudio: boolean): number[] {
  return syllables.map((syllable, index) => {
    const around = syllables.filter(
      (_, other) => other !== index && Math.abs(other - index) <= NEIGHBOURS,
    );
    const stress = syllable.stressed ? STRESS_BONUS : 0;
    if (!around.length) return 1 + stress;
    const mean = (pick: (s: Syllable) => number) =>
      around.reduce((sum, s) => sum + pick(s), 0) / around.length;
    const longer = syllable.lengthSec / mean((s) => s.lengthSec) - 1;
    if (!withAudio) return longer + stress;
    const louder = (syllable.loudnessDb - mean((s) => s.loudnessDb)) / 6;
    const higher = (syllable.pitchSt - mean((s) => s.pitchSt)) / 3;
    return louder + higher + 0.5 * longer + stress;
  });
}

export function speechGestureTiming(
  aligned: readonly AlignedUnit[],
  features: SpeechFeatures | null,
): SpeechGestureTiming {
  // Words: the span of their speech units.
  const words = new Map<number, SpeechWordTiming>();
  for (const { unit, startSec, endSec } of aligned) {
    if (unit.word === undefined || unit.kind === "pause" || unit.kind === "tag")
      continue;
    const word = words.get(unit.word);
    if (word) {
      word.startSec = Math.min(word.startSec, startSec);
      word.endSec = Math.max(word.endSec, endSec);
    } else {
      words.set(unit.word, { wordIndex: unit.word, startSec, endSec });
    }
  }

  // Phrases: words between long pauses, stops and tags.
  const phrases: SpeechPhrase[] = [];
  let phrase: SpeechPhrase | null = null;
  for (const { unit, startSec, endSec } of aligned) {
    const breaks =
      unit.kind === "tag" ||
      (unit.kind === "pause" &&
        (unit.pause === "stop" || endSec - startSec >= PHRASE_BREAK_SEC));
    if (breaks) {
      if (phrase) phrases.push(phrase);
      phrase = null;
      continue;
    }
    if (unit.word === undefined || unit.kind === "pause") continue;
    if (!phrase) {
      phrase = {
        startSec,
        endSec,
        firstWord: unit.word,
        lastWord: unit.word,
      };
    } else {
      phrase.endSec = Math.max(phrase.endSec, endSec);
      phrase.lastWord = Math.max(phrase.lastWord, unit.word);
    }
  }
  if (phrase) phrases.push(phrase);

  // Beats: the most prominent syllables, spaced apart.
  const syllables = measureSyllables(aligned, features);
  const scores = prominence(syllables, features !== null);
  const candidates = syllables
    .map((syllable, index) => ({ syllable, strength: scores[index]! }))
    .filter((candidate) => candidate.strength > 0)
    .sort((a, b) => b.strength - a.strength);
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const tooClose = kept.some(
      (other) =>
        Math.abs(other.syllable.peakSec - candidate.syllable.peakSec) <
        MIN_BEAT_SPACING_SEC,
    );
    if (!tooClose) kept.push(candidate);
  }
  const beats = kept
    .map(({ syllable, strength }) => ({
      timeSec: syllable.peakSec,
      wordIndex: syllable.wordIndex,
      unitIndex: syllable.unitIndex,
      strength,
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  return {
    words: [...words.values()].sort((a, b) => a.wordIndex - b.wordIndex),
    beats,
    phrases,
  };
}
