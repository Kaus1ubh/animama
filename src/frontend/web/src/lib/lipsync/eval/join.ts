/**
 * Clips joined into one longer reply, for tests of multi-sentence planning:
 * features, references and text in order, with silence between, and no
 * provider timing.
 */

import type { EvalClip } from "./clip";

export function joinEvalClips(
  clips: readonly EvalClip[],
  options: {
    /** Silence between clips. */
    gapSec?: number;
    /** Mark each clip as a speech part, as Gemini speaks a reply. */
    parts?: boolean;
  } = {},
): EvalClip {
  const first = clips[0]!;
  const rate = first.features.rate;
  const gap = Math.round((options.gapSec ?? 0.3) * rate);
  const total =
    clips.reduce((sum, clip) => sum + clip.features.loudnessDb.length, 0) +
    gap * (clips.length - 1);
  const loudnessDb = new Float32Array(total).fill(-90);
  const voicing = new Float32Array(total);
  const pitchHz = new Float32Array(total);
  const words: Array<[number, number]> = [];
  const vowels: Array<[number, number, number]> = [];
  const parts: Array<{ startSec: number; text: string }> = [];
  let at = 0;
  for (const clip of clips) {
    const offset = at / rate;
    loudnessDb.set(clip.features.loudnessDb, at);
    voicing.set(clip.features.voicing, at);
    pitchHz.set(clip.features.pitchHz, at);
    for (const [s, e] of clip.reference.words)
      words.push([s + offset, e + offset]);
    for (const [v, s, e] of clip.reference.vowels) {
      vowels.push([v, s + offset, e + offset]);
    }
    parts.push({ startSec: offset, text: clip.text });
    at += clip.features.loudnessDb.length + gap;
  }
  return {
    ...first,
    id: clips.map((clip) => clip.id).join("+"),
    text: clips.map((clip) => clip.text).join(" "),
    durationSec: total / rate,
    features: { rate, loudnessDb, voicing, pitchHz },
    timing: null,
    reference: { words, vowels },
    stressReference: null,
    intervalTags: 0,
    ...(options.parts ? { parts } : {}),
  };
}
