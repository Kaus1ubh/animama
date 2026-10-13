import { describe, expect, it } from "vitest";
import type { SpeechFeatures } from "@/lib/lipsync/audio/features";
import type { LipSyncUnit } from "@/lib/lipsync/text/units";
import { alignUnits, loudnessLevels } from "./aligner";
import { estimateUnitTimes } from "./estimate";

/** Features from spans of [seconds, loudness dB, voicing] at 100 frames a second. */
function features(spans: Array<[number, number, number]>): SpeechFeatures {
  const loudness: number[] = [];
  const voicing: number[] = [];
  for (const [sec, db, voiced] of spans) {
    for (let i = 0; i < Math.round(sec * 100); i += 1) {
      loudness.push(db);
      voicing.push(voiced);
    }
  }
  return {
    rate: 100,
    loudnessDb: Float32Array.from(loudness),
    voicing: Float32Array.from(voicing),
    pitchHz: new Float32Array(loudness.length).fill(200),
  };
}

const syllable = (start: number, word: number): LipSyncUnit => ({
  kind: "syllable",
  vowel: "A",
  weight: 1,
  start,
  end: start + 2,
  word,
});
const stop: LipSyncUnit = {
  kind: "pause",
  pause: "stop",
  weight: 0.3,
  start: 5,
  end: 6,
};
const laugh: LipSyncUnit = {
  kind: "tag",
  weight: 0.9,
  start: 0,
  end: 8,
  tag: { kind: "laugh", label: "[laughs]" },
};

const SILENT = -90;
const SPEECH = -15;

describe("alignUnits", () => {
  // 0.3 s silence, 0.4 s speech, 0.4 s silence, 0.4 s speech, 0.3 s silence.
  const clip = features([
    [0.3, SILENT, 0],
    [0.4, SPEECH, 0.9],
    [0.4, SILENT, 0],
    [0.4, SPEECH, 0.9],
    [0.3, SILENT, 0],
  ]);
  const units = [
    syllable(0, 0),
    syllable(2, 1),
    stop,
    syllable(7, 2),
    syllable(9, 3),
  ];

  it("puts syllables on speech and the pause on the silence between", () => {
    const aligned = alignUnits(units, clip);
    expect(aligned.map((a) => a.unit)).toEqual(units);
    const [first, second, pause, third, fourth] = aligned;
    expect(first!.startSec).toBeCloseTo(0.3, 1);
    expect(second!.endSec).toBeCloseTo(0.7, 1);
    expect(pause!.startSec).toBeCloseTo(0.7, 1);
    expect(pause!.endSec).toBeCloseTo(1.1, 1);
    expect(third!.startSec).toBeCloseTo(1.1, 1);
    expect(fourth!.endSec).toBeCloseTo(1.5, 1);
  });

  it("plans partial audio up to the unit being spoken", () => {
    // 0.9 s arrived: two syllables and the start of the pause. Partial audio
    // cannot measure the speaking rate, so the planner supplies it.
    const partial: SpeechFeatures = {
      rate: 100,
      loudnessDb: clip.loudnessDb.subarray(0, 90),
      voicing: clip.voicing.subarray(0, 90),
      pitchHz: clip.pitchHz.subarray(0, 90),
    };
    const aligned = alignUnits(units, partial, {
      partial: true,
      framesPerWeight: 20,
    });
    expect(aligned.at(-1)!.unit).toBe(stop);
    expect(aligned.at(-1)!.endSec).toBeCloseTo(0.9, 2);
  });

  it("aligns from a frame, keeping times on the clip's clock", () => {
    const aligned = alignUnits(units.slice(3), clip, { fromFrame: 110 });
    expect(aligned[0]!.startSec).toBeGreaterThanOrEqual(1.1);
    expect(aligned[1]!.endSec).toBeCloseTo(1.5, 1);
  });

  it("follows a provider window over an ambiguous signal", () => {
    // One long stretch of speech: the window says where the second syllable starts.
    const flat = features([[1, SPEECH, 0.9]]);
    const two = [syllable(0, 0), syllable(2, 1)];
    const windows = [null, { startSec: 0.7, endSec: 1, toleranceSec: 0.02 }];
    const aligned = alignUnits(two, flat, { windows });
    expect(aligned[1]!.startSec).toBeCloseTo(0.68, 1);
  });

  it("places a laugh on audible, unvoiced sound rather than voiced speech", () => {
    const withLaugh = features([
      [0.2, SILENT, 0],
      [0.6, -20, 0.1],
      [0.4, SPEECH, 0.9],
      [0.2, SILENT, 0],
    ]);
    const aligned = alignUnits(
      [laugh, syllable(8, 0), syllable(10, 1)],
      withLaugh,
    );
    expect(aligned[0]!.unit).toBe(laugh);
    expect(aligned[0]!.startSec).toBeCloseTo(0.2, 1);
    expect(aligned[0]!.endSec).toBeCloseTo(0.8, 1);
  });

  it("measures loudness levels from a histogram", () => {
    const levels = loudnessLevels(clip.loudnessDb);
    expect(levels.peak).toBeCloseTo(SPEECH, 0);
    expect(levels.floor).toBeLessThan(-45);
  });
});

describe("estimateUnitTimes", () => {
  const units = [syllable(0, 0), syllable(2, 1), stop, syllable(7, 2)];

  it("lays units out at prior durations", () => {
    const aligned = estimateUnitTimes(units, { secPerWeight: 0.2 });
    expect(
      aligned.map((a) => [a.startSec, a.endSec].map((t) => +t.toFixed(2))),
    ).toEqual([
      [0, 0.2],
      [0.2, 0.4],
      [0.4, 0.7],
      [0.7, 0.9],
    ]);
  });

  it("re-anchors on known word starts", () => {
    const aligned = estimateUnitTimes(units, {
      secPerWeight: 0.2,
      wordStarts: new Map([
        [0, 0.5],
        [2, 2.5],
      ]),
    });
    expect(aligned[0]!.startSec).toBeCloseTo(0.5);
    expect(aligned[3]!.startSec).toBeCloseTo(2.5);
    // Between anchors, units stretch to fit.
    expect(aligned[1]!.startSec).toBeCloseTo(0.5 + (0.2 / 0.7) * 2);
  });
});
