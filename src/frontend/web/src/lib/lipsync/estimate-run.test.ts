import { beforeAll, describe, expect, it } from "vitest";
import { createEstimateRunPlanner } from "./estimate-run";
import { mergePlanFrames } from "./planned-segment";
import type { RunPlanUpdate } from "./run-planner";
import { loadChineseReadings } from "./text/converters";
import { loadEnglishDictionary } from "./text/english-dictionary";

beforeAll(async () => {
  await Promise.all([loadEnglishDictionary(), loadChineseReadings()]);
});

function run() {
  const updates: RunPlanUpdate[] = [];
  const planner = createEstimateRunPlanner({
    onUpdate: (update) => updates.push(update),
  });
  return { planner, updates, last: () => updates.at(-1)! };
}

describe("createEstimateRunPlanner", () => {
  it("places each utterance's words where the voice starts it", () => {
    const { planner, last } = run();
    planner.startUtterance("Hello there.", 0);
    expect(last().complete).toBe(false);
    const first = last().gestures.words;
    expect(first.map((word) => word.wordIndex)).toEqual([0, 1]);
    expect(first[0]!.startSec).toBe(0);

    planner.startUtterance("How are you?", 2);
    const words = last().gestures.words;
    // Word indices continue across utterances.
    expect(words.map((word) => word.wordIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(words[2]!.startSec).toBeCloseTo(2);
  });

  it("re-anchors words on reported boundaries and fits an ended utterance", () => {
    const { planner, last } = run();
    planner.startUtterance("Hello there, my friend.", 0);
    // "my" starts at 1.5 s, later than the average rate puts it.
    planner.addBoundary("Hello there, ".length, 1.5);
    let words = last().gestures.words;
    expect(words[2]!.startSec).toBeCloseTo(1.5);

    planner.endUtterance(2.6);
    words = last().gestures.words;
    expect(words[2]!.startSec).toBeCloseTo(1.5);
    // "friend" ends with the utterance.
    expect(words[3]!.endSec).toBeCloseTo(2.6);
    expect(last().complete).toBe(true);
    expect(last().audioSec).toBeCloseTo(2.6);
  });

  it("reads Han characters by the whole reply so far", () => {
    // How long "東京駅" takes, after `before` (if any) has been spoken.
    const kanjiSec = (before: string | null) => {
      const { planner, last } = run();
      if (before) planner.startUtterance(before, 0);
      planner.startUtterance("東京駅。", 5);
      const words = last().gestures.words.filter((word) => word.startSec >= 5);
      return Math.max(...words.map((word) => word.endSec)) - 5;
    };
    // Alone, read as Chinese syllables; after kana, as longer Japanese kanji.
    expect(kanjiSec("こんにちは。")).toBeGreaterThan(kanjiSec(null) * 1.3);
  });

  it("renders a mouth that moves through the text", () => {
    const { planner, updates } = run();
    planner.startUtterance("Hello there.", 0);
    planner.endUtterance(1);
    const frames = updates.reduce<Float32Array | null>(
      (track, update) => mergePlanFrames(track, update),
      null,
    )!;
    expect(frames.length / 5).toBeGreaterThanOrEqual(60);
    expect(Math.max(...frames)).toBeGreaterThan(0.3);
  });
});
