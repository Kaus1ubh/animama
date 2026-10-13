import { describe, expect, it } from "vitest";
import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import type { AlignedUnit } from "@/lib/lipsync/align/aligner";
import { frameOpenness, LIPSYNC_FPS } from "@/lib/lipsync/track";
import type { LipSyncUnit } from "@/lib/lipsync/text/units";
import { speechGestureTiming } from "./beats";
import { renderAlignedUnits, speechOpenness } from "./render";

const at = (
  unit: Partial<LipSyncUnit>,
  startSec: number,
  endSec: number,
): AlignedUnit => ({
  unit: { kind: "syllable", weight: 1, start: 0, end: 1, ...unit },
  startSec,
  endSec,
});
const frame = (sec: number) => Math.round(sec * LIPSYNC_FPS);
const OPEN = (count: number) => new Float32Array(count).fill(0.8);

describe("renderAlignedUnits", () => {
  it("shows each syllable's vowel and closes the mouth in pauses", () => {
    const track = renderAlignedUnits(
      [
        at({ vowel: "A", word: 0 }, 0, 0.3),
        at({ kind: "pause", pause: "stop" }, 0.3, 0.6),
        at({ vowel: "O", word: 1 }, 0.6, 0.9),
      ],
      1,
      OPEN(61),
    );
    expect(track.frames[frame(0.15) * 5]).toBeGreaterThan(0.5);
    expect(track.frames[frame(0.75) * 5 + 3]).toBeGreaterThan(0.5);
    expect(frameOpenness(track, frame(0.45))).toBe(0);
    expect(track.events).toEqual([
      { kind: "pause", startSec: 0.3, endSec: 0.6 },
    ]);
  });

  it("draws weak and whispered vowels smaller", () => {
    const strong = renderAlignedUnits(
      [at({ vowel: "E" }, 0, 0.3)],
      0.3,
      OPEN(19),
    );
    const weak = renderAlignedUnits(
      [at({ vowel: "E", weak: true }, 0, 0.3)],
      0.3,
      OPEN(19),
    );
    const whisper = renderAlignedUnits(
      [at({ vowel: "E", whisper: true }, 0, 0.3)],
      0.3,
      OPEN(19),
    );
    const middle = frame(0.15) * 5 + 1;
    expect(weak.frames[middle]).toBeLessThan(strong.frames[middle]! * 0.7);
    expect(whisper.frames[middle]).toBeLessThan(strong.frames[middle]!);
  });

  it("gives an unknown vowel a neutral opening", () => {
    const track = renderAlignedUnits(
      [at({ kind: "unknown" }, 0, 0.3)],
      0.3,
      OPEN(19),
    );
    const f = frame(0.15) * 5;
    expect(track.frames[f]).toBeGreaterThan(0.3);
    expect(track.frames[f + 1]).toBeGreaterThan(0.1);
    expect(track.frames[f + 2]).toBe(0);
  });

  it("shapes and reports tags by kind", () => {
    const tag = (kind: "laugh" | "sigh" | "sound_effect", label: string) =>
      ({ kind: "tag", tag: { kind, label } }) as Partial<LipSyncUnit>;
    const track = renderAlignedUnits(
      [
        at(tag("laugh", "[laughs]"), 0, 0.5),
        at(tag("sigh", "<sigh>"), 0.5, 1),
        at(tag("sound_effect", "[door]"), 1, 1.5),
      ],
      1.5,
      OPEN(91),
    );
    expect(track.frames[frame(0.25) * 5]).toBeGreaterThan(0.8);
    expect(track.frames[frame(0.6) * 5 + 3]).toBeGreaterThan(0.4);
    expect(frameOpenness(track, frame(1.25))).toBe(0);
    expect(track.events.map((event) => event.label)).toEqual([
      "[laughs]",
      "<sigh>",
      "[door]",
    ]);
  });

  it("follows loudness: closed in silence, open in speech", () => {
    const features: SpeechFeatures = {
      rate: 100,
      loudnessDb: Float32Array.from({ length: 60 }, (_, i) =>
        i < 30 ? -90 : -15,
      ),
      voicing: new Float32Array(60),
      pitchHz: new Float32Array(60),
    };
    const openness = speechOpenness(features, { floor: -60, peak: -15 }, 37);
    expect(openness[frame(0.2)]).toBe(0);
    expect(openness[frame(0.55)]).toBeGreaterThan(0.8);
  });
});

describe("speechGestureTiming", () => {
  // Six syllables over 1.2 s; the third is louder and higher than its neighbours.
  const features: SpeechFeatures = {
    rate: 100,
    loudnessDb: Float32Array.from({ length: 120 }, (_, i) =>
      i >= 40 && i < 60 ? -10 : -20,
    ),
    voicing: new Float32Array(120).fill(0.9),
    pitchHz: Float32Array.from({ length: 120 }, (_, i) =>
      i >= 40 && i < 60 ? 260 : 200,
    ),
  };
  const aligned = [0, 1, 2, 3, 4, 5].map((index) =>
    at(
      { vowel: "A", word: Math.floor(index / 2) },
      index * 0.2,
      index * 0.2 + 0.2,
    ),
  );

  it("beats on the most prominent syllable, spaced at least 0.4 s", () => {
    const { beats } = speechGestureTiming(aligned, features);
    expect(beats[0]).toMatchObject({ wordIndex: 1, unitIndex: 2 });
    for (let k = 1; k < beats.length; k += 1) {
      expect(beats[k]!.timeSec - beats[k - 1]!.timeSec).toBeGreaterThanOrEqual(
        0.4,
      );
    }
  });

  it("never beats on a tag, a pause or a weak vowel", () => {
    const { beats } = speechGestureTiming(
      [
        at({ kind: "tag", tag: { kind: "laugh", label: "[laughs]" } }, 0, 0.5),
        at({ kind: "pause", pause: "break" }, 0.5, 0.7),
        at({ vowel: "E", weak: true, word: 0 }, 0.7, 0.8),
      ],
      null,
    );
    expect(beats).toEqual([]);
  });

  it("times words and splits phrases at stops", () => {
    const { words, phrases } = speechGestureTiming(
      [
        at({ vowel: "A", word: 0 }, 0, 0.2),
        at({ vowel: "A", word: 0 }, 0.2, 0.4),
        at({ kind: "pause", pause: "stop" }, 0.4, 0.5),
        at({ vowel: "O", word: 1 }, 0.5, 0.8),
      ],
      null,
    );
    expect(words).toEqual([
      { wordIndex: 0, startSec: 0, endSec: 0.4 },
      { wordIndex: 1, startSec: 0.5, endSec: 0.8 },
    ]);
    expect(phrases).toEqual([
      { startSec: 0, endSec: 0.4, firstWord: 0, lastWord: 0 },
      { startSec: 0.5, endSec: 0.8, firstWord: 1, lastWord: 1 },
    ]);
  });

  it("prefers a stressed syllable without audio", () => {
    const { beats } = speechGestureTiming(
      [
        at({ vowel: "A", word: 0 }, 0, 0.2),
        at({ vowel: "A", word: 0, stressed: true }, 0.2, 0.4),
        at({ vowel: "A", word: 1 }, 0.4, 0.6),
      ],
      null,
    );
    expect(beats.map((beat) => beat.unitIndex)).toEqual([1]);
  });
});
