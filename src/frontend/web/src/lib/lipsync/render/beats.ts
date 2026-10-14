/**
 * Gesture timing from aligned units: when each word is spoken, the beats that
 * talking hands can land on, and the phrases between pauses.
 *
 * A beat falls on a prominent syllable: louder, higher-pitched or longer than
 * its neighbours, which works in any language. Where the text marks stress
 * (English), it tips the balance between syllables that are close. Beats are at
 * least 0.4 s apart, the strongest kept first. Tags, pauses and weak vowels
 * never carry a beat. Without audio, prominence comes from stress and length
 * alone, for provisional beats: words not heard yet, placed at the speaking
 * rate, give talking hands beats ahead of the audio until it arrives.
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
  /** The phrase ends with an exclamation mark. */
  exclamation?: boolean;
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

const MAX_PITCH_HZ = 1000;

/** The median of voiced frames' pitch, from a 1 Hz histogram. */
function medianVoicedPitch(features: SpeechFeatures): number {
  const counts = new Uint32Array(MAX_PITCH_HZ + 1);
  let total = 0;
  for (let t = 0; t < features.pitchHz.length; t += 1) {
    if (features.voicing[t]! <= VOICED) continue;
    counts[
      Math.min(MAX_PITCH_HZ, Math.max(0, Math.round(features.pitchHz[t]!)))
    ]! += 1;
    total += 1;
  }
  let seen = 0;
  for (let hz = 0; hz <= MAX_PITCH_HZ; hz += 1) {
    seen += counts[hz]!;
    if (seen > total / 2) return hz;
  }
  return 0;
}

function measureSyllables(
  aligned: readonly AlignedUnit[],
  features: SpeechFeatures | null,
): Syllable[] {
  const medianPitch = features ? medianVoicedPitch(features) : 0;
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
    const around = [
      ...syllables.slice(Math.max(0, index - NEIGHBOURS), index),
      ...syllables.slice(index + 1, index + 1 + NEIGHBOURS),
    ];
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

/**
 * The most prominent syllables, at least `MIN_BEAT_SPACING_SEC` apart from
 * each other and from the beats already `kept`, strongest first.
 */
function selectBeats(
  syllables: readonly Syllable[],
  withAudio: boolean,
  kept: readonly SpeechBeat[],
): SpeechBeat[] {
  const scores = prominence([...syllables], withAudio);
  const candidates = syllables
    .map((syllable, index) => ({ syllable, strength: scores[index]! }))
    .filter((candidate) => candidate.strength > 0)
    .sort((a, b) => b.strength - a.strength);
  const chosen: SpeechBeat[] = [];
  for (const { syllable, strength } of candidates) {
    const tooClose = [...kept, ...chosen].some(
      (other) =>
        Math.abs(other.timeSec - syllable.peakSec) < MIN_BEAT_SPACING_SEC,
    );
    if (tooClose) continue;
    chosen.push({
      timeSec: syllable.peakSec,
      wordIndex: syllable.wordIndex,
      unitIndex: syllable.unitIndex,
      strength,
    });
  }
  return chosen;
}

/**
 * Gesture timing for `aligned` units heard in `features`, and for
 * `provisional` units after them: words not heard yet, placed at the speaking
 * rate. Provisional beats' `unitIndex` counts on from the aligned units.
 */
export function speechGestureTiming(
  aligned: readonly AlignedUnit[],
  features: SpeechFeatures | null,
  provisional: readonly AlignedUnit[] = [],
): SpeechGestureTiming {
  const all = provisional.length ? [...aligned, ...provisional] : aligned;
  // Words: the span of their speech units.
  const words = new Map<number, SpeechWordTiming>();
  for (const { unit, startSec, endSec } of all) {
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
  for (const { unit, startSec, endSec } of all) {
    const breaks =
      unit.kind === "tag" ||
      (unit.kind === "pause" &&
        (unit.pause === "stop" || endSec - startSec >= PHRASE_BREAK_SEC));
    if (breaks) {
      if (phrase) {
        if (unit.exclaim) phrase.exclamation = true;
        phrases.push(phrase);
      }
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

  // Beats: the most prominent syllables, spaced apart; heard ones first.
  const heard = selectBeats(
    measureSyllables(aligned, features),
    features !== null,
    [],
  );
  const ahead = provisional.length
    ? selectBeats(
        measureSyllables(provisional, null).map((syllable) => ({
          ...syllable,
          unitIndex: syllable.unitIndex + aligned.length,
        })),
        false,
        heard,
      )
    : [];
  const beats = [...heard, ...ahead].sort((a, b) => a.timeSec - b.timeSec);

  return {
    words: [...words.values()].sort((a, b) => a.wordIndex - b.wordIndex),
    beats,
    phrases,
  };
}
