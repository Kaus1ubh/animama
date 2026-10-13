import { describe, expect, it } from "vitest";
import {
  emptyLipSyncTrack,
  LIPSYNC_FPS,
  type LipSyncTrack,
} from "@/lib/lipsync/track";
import { runPlanSource, type EvalPlanSource } from "./arrival";
import { decodeEvalClip, encodeEvalClip, type EvalClip } from "./clip";
import { bestGapIou, percentile, referenceGaps, scoreClip } from "./metrics";
import { referenceFromAlignment } from "./reference";
import { summarise, scoreRun } from "./report";

/** A 2 s Japanese clip: words at 0.2–0.8 s and 1.2–1.8 s, loud only inside words. */
function clip(overrides: Partial<EvalClip> = {}): EvalClip {
  const frames = 200;
  const loudnessDb = new Float32Array(frames).fill(-80);
  for (let f = 0; f < frames; f += 1) {
    const t = f / 100;
    if ((t >= 0.2 && t < 0.8) || (t >= 1.2 && t < 1.8)) loudnessDb[f] = -20;
  }
  return {
    id: "test",
    provider: "gemini",
    model: null,
    voice: "Leda",
    lang: "ja",
    text: "あい [laughs] うえ",
    set: "main",
    groups: ["cjk", "tags"],
    heldOut: false,
    intervalTags: 1,
    durationSec: 2,
    sampleRate: 24000,
    features: {
      rate: 100,
      loudnessDb,
      voicing: new Float32Array(frames),
      pitchHz: new Float32Array(frames),
    },
    timing: null,
    reference: {
      words: [
        [0.2, 0.8],
        [1.2, 1.8],
      ],
      vowels: [
        [0, 0.2, 0.5],
        [2, 0.5, 0.8],
        [4, 1.2, 1.5],
        [1, 1.5, 1.8],
      ],
    },
    estimated: null,
    ...overrides,
  };
}

/** A track that opens the reference vowel inside the words and is closed elsewhere. */
function perfectTrack(c: EvalClip): LipSyncTrack {
  const track = emptyLipSyncTrack(c.durationSec);
  for (const [vowel, start, end] of c.reference.vowels) {
    for (
      let f = Math.ceil(start * LIPSYNC_FPS);
      f < end * LIPSYNC_FPS;
      f += 1
    ) {
      track.frames[f * 5 + vowel] = 0.8;
    }
  }
  return track;
}

describe("referenceGaps", () => {
  it("finds leading, inner and trailing gaps of 150 ms or more", () => {
    expect(referenceGaps(clip().reference, 2)).toEqual([
      [0, 0.2],
      [0.8, 1.2],
      [1.8, 2],
    ]);
    expect(
      referenceGaps(
        {
          words: [
            [0.1, 0.5],
            [0.6, 1.9],
          ],
          vowels: [],
        },
        2,
      ),
    ).toEqual([]);
  });
});

describe("percentile", () => {
  it("interpolates like numpy", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 97)).toBe(10);
    expect(percentile([0, 100], 97)).toBeCloseTo(97);
  });
});

describe("scoreClip", () => {
  it("scores a perfect track as matching every open vowel and closed in silence", () => {
    const c = clip();
    const score = scoreClip(perfectTrack(c), c);
    expect(score.vowelMatch).toBe(1);
    expect(score.openInSilence).toBe(0);
    expect(score.vowelOpen).toBeGreaterThan(0.9);
    expect(score.corr).toBeGreaterThan(0.8);
    expect(score.lagMs).toBe(0);
  });

  it("counts an always-open mouth as open in every silent frame", () => {
    const c = clip();
    const track = emptyLipSyncTrack(c.durationSec);
    track.frames.fill(0.5);
    const score = scoreClip(track, c);
    expect(score.openInSilence).toBe(1);
    expect(score.silentFrames).toBeGreaterThan(0);
  });

  it("scores the wrong vowel as a mismatch", () => {
    const c = clip();
    const track = emptyLipSyncTrack(c.durationSec);
    for (let f = 0; f < track.frames.length / 5; f += 1)
      track.frames[f * 5 + 3] = 0.8;
    expect(scoreClip(track, c).vowelMatch).toBe(0);
  });

  it("does not score vowel identity in English", () => {
    const c = clip({ lang: "en" });
    expect(scoreClip(perfectTrack(c), c).vowelMatch).toBeNull();
  });

  it("measures tag events against the reference gaps", () => {
    const c = clip();
    const track = perfectTrack(c);
    track.events.push({
      kind: "laugh",
      startSec: 0.8,
      endSec: 1.2,
      label: "[laughs]",
    });
    // A whisper is a delivery, and a comma pause did not come from a tag.
    track.events.push({
      kind: "whisper",
      startSec: 0,
      endSec: 2,
      label: "[whispers]",
    });
    track.events.push({ kind: "pause", startSec: 0.8, endSec: 1.2 });
    expect(scoreClip(track, c).tagIous).toEqual([1]);
    expect(bestGapIou(0.9, 1.3, [[0.8, 1.2]])).toBeCloseTo(0.6);
  });
});

describe("referenceFromAlignment", () => {
  it("maps romanised Korean eo and eu to one vowel", () => {
    const reference = referenceFromAlignment(
      [
        {
          word: "eoseo",
          start: 0,
          end: 0.5,
          chars: [
            ["e", 0, 0.1, 1],
            ["o", 0.1, 0.2, 1],
            ["s", 0.2, 0.3, 1],
            ["e", 0.3, 0.4, 1],
            ["u", 0.4, 0.5, 1],
          ],
        },
      ],
      "ko",
    );
    expect(reference.words).toEqual([[0, 0.5]]);
    expect(reference.vowels).toEqual([
      [3, 0, 0.2],
      [2, 0.3, 0.5],
    ]);
  });
});

describe("encodeEvalClip", () => {
  it("round-trips within the quantization steps", () => {
    const c = clip({
      timing: [{ char: "あ", startSec: 0.2, endSec: 0.35 }],
      features: {
        rate: 100,
        loudnessDb: Float32Array.from([-100, -37.3, -12.4]),
        voicing: Float32Array.from([0, 0.5, 0.99]),
        pitchHz: Float32Array.from([0, 210.4, 333]),
      },
    });
    const decoded = decodeEvalClip(
      JSON.parse(JSON.stringify(encodeEvalClip(c))),
    );
    expect(Array.from(decoded.features.loudnessDb)).toEqual([
      -100, -37.5, -12.5,
    ]);
    decoded.features.voicing.forEach((value, index) =>
      expect(Math.abs(value - c.features.voicing[index]!)).toBeLessThan(
        1 / 255,
      ),
    );
    expect(Array.from(decoded.features.pitchHz)).toEqual([0, 210, 333]);
    expect(decoded.timing).toEqual(c.timing);
    expect(decoded.intervalTags).toBe(1);
  });
});

describe("runPlanSource", () => {
  const source: EvalPlanSource = {
    id: "probe",
    label: "Probe",
    progressive: true,
    // Opens the mouth from the start up to the newest available feature frame.
    plan: ({ clip: c, features, complete }) => {
      const track = emptyLipSyncTrack(c.durationSec);
      const known = complete
        ? c.durationSec
        : features.loudnessDb.length / features.rate;
      for (let f = 0; f <= known * LIPSYNC_FPS; f += 1) track.frames[f * 5] = 1;
      track.events.push({
        kind: "laugh",
        startSec: 0.8,
        endSec: Math.min(1.2, known),
        label: "[laughs]",
      });
      return track;
    },
  };

  it("plans once for the whole clip", () => {
    const run = runPlanSource(source, clip(), { kind: "whole" });
    expect(run.runs).toBe(1);
    expect(run.track.frames[60 * 5]).toBe(1);
  });

  it("commits frames only as playback reaches them in a live stream", () => {
    const run = runPlanSource(source, clip(), { kind: "live", bufferSec: 0.3 });
    expect(run.runs).toBe(8);
    // Every committed frame was planned from audio that had already arrived.
    for (let f = 0; f < run.track.frames.length / 5; f += 1)
      expect(run.track.frames[f * 5]).toBe(1);
    // The laugh event is committed in pieces and merged back into one span.
    expect(run.track.events).toHaveLength(1);
    expect(run.track.events[0]!.startSec).toBeCloseTo(0.8);
    expect(run.track.events[0]!.endSec).toBeCloseTo(1.2);
  });

  // Each frame records the arrival time of the plan that filled it.
  const stamping: EvalPlanSource = {
    id: "stamp",
    label: "Stamp",
    progressive: true,
    plan: ({ clip: c, arrivedSec, complete }) => {
      const track = emptyLipSyncTrack(c.durationSec);
      track.frames.fill(complete ? 99 : arrivedSec);
      return track;
    },
  };

  it.each([
    ["live", { kind: "live", bufferSec: 0.3 } as const, (t: number) => t + 0.3],
    ["faster", { kind: "faster", rate: 2.9 } as const, (t: number) => t * 2.9],
  ])(
    "fills each %s frame from a plan made before the frame played",
    (_name, mode, arrivedWhenPlayed) => {
      const c = clip();
      const run = runPlanSource(stamping, c, mode);
      const count = run.track.frames.length / 5;
      for (let f = 0; f < count; f += 1) {
        const planArrived = run.track.frames[f * 5]!;
        if (planArrived === 99) continue;
        expect(planArrived).toBeLessThanOrEqual(
          arrivedWhenPlayed(f / LIPSYNC_FPS) + 1e-9,
        );
      }
    },
  );

  it("summarises tags placed against the clip's interval tags", () => {
    const c = clip();
    const scored = scoreRun(c, runPlanSource(source, c, { kind: "whole" }));
    const summary = summarise([scored]);
    expect(summary.tagsPlaced).toBe(1);
    expect(summary.tagsTotal).toBe(1);
    expect(summary.vowelMatchCjk).not.toBeNull();
  });
});
