/**
 * Evaluation clips: one recorded TTS line, reduced to what a lip-sync planner
 * sees (text as sent, audio features, provider timing) plus what scoring needs
 * (reference word and vowel timings). The audio itself is never stored.
 *
 * Fixtures store features quantized and base64-encoded to stay small:
 * loudness in 0.5 dB steps from -100 dBFS, voicing in 1/255 steps and pitch in
 * whole hertz.
 */

import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import { base64ToBytes, bytesToBase64 } from "@/lib/lipsync/base64";

export type EvalLanguage = "en" | "ja" | "ko" | "zh" | "es";
export type EvalProvider = "gemini" | "pocket" | "openai" | "elevenlabs";

/** Scoring groups; a clip can be in several. */
export type EvalGroup = "english" | "tags" | "cjk" | "es";

/**
 * Clip sets: the research brief's main set, ElevenLabs v4 over HTTP and
 * ElevenLabs v4 Turbo over the dialogue socket.
 */
export type EvalSet = "main" | "eleven-http" | "eleven-socket";

export type EvalReference = {
  /** Spoken words as [start, end] seconds. */
  words: Array<[number, number]>;
  /** Reference vowels as [vowel index (A, E, I, O, U), start, end]. */
  vowels: Array<[number, number, number]>;
};

/**
 * gruut 2.4.0's reading of an English line, recorded before gruut was removed:
 * its words and their phonemes, with stress marks. The fixed reference for
 * where beats should fall.
 */
export type StressReference = {
  tokenizedText: string;
  phonemizedText: string[][];
};

export type EvalClipMeta = {
  id: string;
  provider: EvalProvider;
  model: string | null;
  voice: string;
  lang: EvalLanguage;
  /** The text as sent to the provider, tags included. */
  text: string;
  set: EvalSet;
  groups: EvalGroup[];
  /** Not used for tuning; reported separately. */
  heldOut: boolean;
  /**
   * Tags the voice performs as intervals (laughs, sighs, gasps, pauses), the
   * most a planner can place. Delivery tags such as whispers are not counted.
   */
  intervalTags: number;
};

export type EvalClip = EvalClipMeta & {
  durationSec: number;
  /** The recorded audio's sample rate; all providers here deliver 24 kHz. */
  sampleRate: number;
  features: SpeechFeatures;
  /** Provider character timing on the clip clock, when the provider gives it. */
  timing: TimedChar[] | null;
  reference: EvalReference;
  stressReference: StressReference | null;
  /**
   * Where each speech part's audio starts, for clips joined from several
   * parts, as a reply spoken part by part arrives. Recorded clips are one part.
   */
  parts?: Array<{ startSec: number; text: string }>;
};

export type EncodedEvalClip = EvalClipMeta & {
  durationSec: number;
  sampleRate: number;
  features: {
    rate: number;
    loudnessDb: string;
    voicing: string;
    pitchHz: string;
  };
  timing: Array<[string, number, number]> | null;
  reference: EvalReference;
  stressReference: StressReference | null;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export function encodeEvalClip(clip: EvalClip): EncodedEvalClip {
  const { features } = clip;
  const loudness = Uint8Array.from(features.loudnessDb, (db) =>
    Math.max(0, Math.min(255, Math.round((db + 100) * 2))),
  );
  const voicing = Uint8Array.from(features.voicing, (value) =>
    Math.max(0, Math.min(255, Math.round(value * 255))),
  );
  const pitch = new Uint8Array(features.pitchHz.length * 2);
  const view = new DataView(pitch.buffer);
  features.pitchHz.forEach((hz, index) =>
    view.setUint16(
      index * 2,
      Math.max(0, Math.min(65535, Math.round(hz))),
      true,
    ),
  );
  return {
    id: clip.id,
    provider: clip.provider,
    model: clip.model,
    voice: clip.voice,
    lang: clip.lang,
    text: clip.text,
    set: clip.set,
    groups: clip.groups,
    heldOut: clip.heldOut,
    intervalTags: clip.intervalTags,
    durationSec: round(clip.durationSec, 4),
    sampleRate: clip.sampleRate,
    features: {
      rate: features.rate,
      loudnessDb: bytesToBase64(loudness),
      voicing: bytesToBase64(voicing),
      pitchHz: bytesToBase64(pitch),
    },
    timing: clip.timing
      ? clip.timing.map((c) => [
          c.char,
          round(c.startSec, 4),
          round(c.endSec, 4),
        ])
      : null,
    reference: {
      words: clip.reference.words.map(([s, e]) => [round(s, 3), round(e, 3)]),
      vowels: clip.reference.vowels.map(([v, s, e]) => [
        v,
        round(s, 3),
        round(e, 3),
      ]),
    },
    stressReference: clip.stressReference,
  };
}

export function decodeEvalClip(encoded: EncodedEvalClip): EvalClip {
  const loudness = base64ToBytes(encoded.features.loudnessDb);
  const voicing = base64ToBytes(encoded.features.voicing);
  const pitchBytes = base64ToBytes(encoded.features.pitchHz);
  const view = new DataView(
    pitchBytes.buffer,
    pitchBytes.byteOffset,
    pitchBytes.byteLength,
  );
  const pitch = new Float32Array(pitchBytes.length / 2);
  for (let i = 0; i < pitch.length; i += 1)
    pitch[i] = view.getUint16(i * 2, true);
  return {
    id: encoded.id,
    provider: encoded.provider,
    model: encoded.model,
    voice: encoded.voice,
    lang: encoded.lang,
    text: encoded.text,
    set: encoded.set,
    groups: encoded.groups,
    heldOut: encoded.heldOut,
    intervalTags: encoded.intervalTags,
    durationSec: encoded.durationSec,
    sampleRate: encoded.sampleRate,
    features: {
      rate: encoded.features.rate,
      loudnessDb: Float32Array.from(loudness, (code) => code / 2 - 100),
      voicing: Float32Array.from(voicing, (code) => code / 255),
      pitchHz: pitch,
    },
    timing: encoded.timing
      ? encoded.timing.map(([char, startSec, endSec]) => ({
          char,
          startSec,
          endSec,
        }))
      : null,
    reference: encoded.reference,
    stressReference: encoded.stressReference,
  };
}
