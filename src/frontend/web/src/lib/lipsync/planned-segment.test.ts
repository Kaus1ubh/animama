import { describe, expect, it } from "vitest";
import {
  mergePlanFrames,
  phraseChunks,
  plannedGestureTimeline,
  plannedSegment,
  playbackGaps,
  playbackTime,
  runTime,
  tagOverlayWeights,
} from "./planned-segment";

/** A track of `count` frames, each frame's A weight its index. */
const track = (count: number) =>
  Float32Array.from({ length: count * 5 }, (_, i) => (i % 5 === 0 ? i / 5 : 0));

describe("planned segments", () => {
  it("merges an update into the frames already planned", () => {
    const merged = mergePlanFrames(track(4), {
      fromFrame: 2,
      frames: new Float32Array([9, 0, 0, 0, 0, 9, 0, 0, 0, 0, 9, 0, 0, 0, 0]),
      frameCount: 5,
    });
    expect(Array.from({ length: 5 }, (_, i) => merged[i * 5])).toEqual([
      0, 1, 9, 9, 9,
    ]);
  });

  it("maps run time past the silence underruns insert", () => {
    // Playback started at 10; run second 3 resumed at 13.4, run second 5 at 15.7.
    const gaps = playbackGaps(
      [
        { runSec: 0, contextSec: 10 },
        { runSec: 3, contextSec: 13.4 },
        { runSec: 5, contextSec: 15.7 },
      ],
      10,
    );
    expect(gaps.map((gap) => [gap.runSec, +gap.delaySec.toFixed(3)])).toEqual([
      [3, 0.4],
      [5, 0.3],
    ]);
    expect(playbackTime(2, gaps)).toBe(2);
    expect(playbackTime(4, gaps)).toBeCloseTo(4.4);
    expect(playbackTime(6, gaps)).toBeCloseTo(6.7);
    expect(runTime(4.4, gaps)).toBeCloseTo(4);
    expect(runTime(3.2, gaps)).toBe(3);
  });

  it("closes the mouth through a gap and delays what follows", () => {
    const segment = plannedSegment("run", track(120), [
      { runSec: 1, delaySec: 0.5 },
    ]);
    expect(segment.segmentId).toBe("viseme-run");
    expect(segment.durationSec).toBeCloseTo(119 / 60 + 0.5);
    const at = (time: number) =>
      segment.frames.filter((frame) => Math.abs(frame.time_sec! - time) < 1e-6);
    expect(at(1)[0]!.values).toEqual([0, 0, 0, 0, 0]);
    // Run frame 60 (1 s) now plays at 1.5 s.
    expect(
      segment.frames.find((frame) => frame.frame_index === 60)!.time_sec,
    ).toBeCloseTo(1.5);
  });

  it("builds the talking-hands timeline and phrase chunks", () => {
    const gestures = {
      words: [
        { wordIndex: 0, startSec: 0.1, endSec: 0.4 },
        { wordIndex: 1, startSec: 0.5, endSec: 0.9 },
      ],
      beats: [{ timeSec: 0.2, wordIndex: 0, unitIndex: 3, strength: 1 }],
      phrases: [{ startSec: 0.1, endSec: 0.9, firstWord: 0, lastWord: 1 }],
    };
    const timeline = plannedGestureTimeline(gestures, 1.2);
    expect(timeline.beats).toEqual([
      { timeSec: 0.2, wordIndex: 0, phonemeIndex: 3, phoneme: "" },
    ]);
    expect(timeline.utteranceDurationSec).toBe(1.2);
    expect(phraseChunks("run", timeline.phrases!)).toMatchObject([
      { wordStartIndex: 0, wordEndIndex: 2, boundaryType: "final" },
    ]);
  });

  it("ramps a tag's expression in and out around its sound", () => {
    const events = [
      { kind: "laugh", startSec: 1, endSec: 2, label: "[laughs]" },
      { kind: "pause", startSec: 3, endSec: 4 },
    ];
    expect(tagOverlayWeights(events, 0.5)).toEqual({});
    expect(tagOverlayWeights(events, 1.075).happy).toBeCloseTo(0.4);
    expect(tagOverlayWeights(events, 1.5).happy).toBeCloseTo(0.8);
    expect(tagOverlayWeights(events, 2.15).happy).toBeCloseTo(0.4);
    expect(tagOverlayWeights(events, 3.5)).toEqual({});
  });
});
