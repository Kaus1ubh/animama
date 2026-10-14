import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnglishDictionary } from "./text/english-dictionary";
import { createLipSyncRunPlanner, type RunPlanUpdate } from "./run-planner";

/** Set to make the next planner created throw when it plans. */
const breakNext = vi.hoisted(() => ({ planner: false }));
vi.mock("./planner", async (importActual) => {
  const actual = await importActual<typeof import("./planner")>();
  return {
    ...actual,
    createLipSyncPlanner: (
      options: Parameters<typeof actual.createLipSyncPlanner>[0],
    ) => {
      const planner = actual.createLipSyncPlanner(options);
      if (!breakNext.planner) return planner;
      breakNext.planner = false;
      return {
        ...planner,
        plan: () => {
          throw new Error("planning broke");
        },
      };
    },
  };
});

const RATE = 24_000;

/** Voiced bursts (a 150 Hz tone) of `burstSec`, separated by silence. */
function speechLike(
  bursts: number,
  burstSec = 0.3,
  gapSec = 0.15,
): Float32Array {
  const out = new Float32Array(Math.round(bursts * (burstSec + gapSec) * RATE));
  for (let b = 0; b < bursts; b += 1) {
    const start = Math.round(b * (burstSec + gapSec) * RATE);
    for (let i = 0; i < burstSec * RATE; i += 1) {
      out[start + i] = 0.4 * Math.sin((2 * Math.PI * 150 * i) / RATE);
    }
  }
  return out;
}

beforeAll(async () => {
  await loadEnglishDictionary();
});

describe("createLipSyncRunPlanner", () => {
  it("plans every quarter second of audio and once more when complete", () => {
    const updates: RunPlanUpdate[] = [];
    const run = createLipSyncRunPlanner({
      sampleRate: RATE,
      onUpdate: (update) => updates.push(update),
    });
    run.setText("Hello there, my friend.", false);
    const audio = speechLike(4);
    for (let at = 0; at < audio.length; at += 2400) {
      run.pushPcm(audio.subarray(at, at + 2400));
    }
    expect(updates.length).toBeGreaterThanOrEqual(6);
    expect(updates.every((update) => !update.complete)).toBe(true);

    run.endAudio();
    // The plan completes only once the text is final too.
    expect(updates.at(-1)!.complete).toBe(false);
    run.setText("Hello there, my friend.", true);
    const last = updates.at(-1)!;
    expect(last.complete).toBe(true);
    expect(last.frameCount).toBeGreaterThan(100);
    // Each update carries the frames from its first change on.
    expect(last.frames.length).toBe((last.frameCount - last.fromFrame) * 5);
    expect(updates.map((update) => update.seq)).toEqual(
      updates.map((_, index) => index + 1),
    );

    // Nothing more after completion.
    run.pushPcm(audio);
    expect(updates.at(-1)).toBe(last);
  });

  it("follows the audio alone when planning fails", () => {
    breakNext.planner = true;
    const updates: RunPlanUpdate[] = [];
    const run = createLipSyncRunPlanner({
      sampleRate: RATE,
      onUpdate: (update) => updates.push(update),
    });
    run.setText("Hello there, my friend.", true);
    run.pushPcm(speechLike(4));
    run.endAudio();

    expect(updates.length).toBeGreaterThan(1);
    expect(updates.every((u) => u.fallback === "planner_failed")).toBe(true);
    // The error is reported once.
    expect(updates.map((u) => u.error)).toEqual([
      "planning broke",
      ...updates.slice(1).map(() => undefined),
    ]);
    const last = updates.at(-1)!;
    expect(last.complete).toBe(true);
    // The mouth opens with the bursts.
    expect(
      Math.max(...updates.flatMap((update) => Array.from(update.frames))),
    ).toBeGreaterThan(0.3);
  });

  it("plans a reply spoken in parts, complete when its audio is", () => {
    const updates: RunPlanUpdate[] = [];
    const run = createLipSyncRunPlanner({
      sampleRate: RATE,
      onUpdate: (update) => updates.push(update),
    });
    // The growing reply text is ignored once parts name their own.
    run.setText("Hello there, my friend. Good to see you.", false);
    run.startPart("Hello there, my friend.");
    run.pushPcm(speechLike(4));
    run.startPart("Good to see you.");
    run.pushPcm(speechLike(3));
    run.setText("Something else entirely.", false);
    run.endAudio();

    const last = updates.at(-1)!;
    expect(last.complete).toBe(true);
    expect(last.fallback).toBeNull();
    // Both parts' words, the second part's within its own audio.
    const words = last.gestures.words;
    expect(words.length).toBe(8);
    // The extractor holds back its newest frame, so a part may start 10 ms early.
    const partStartSec = 4 * 0.45 - 0.02;
    expect(words.slice(4).every((word) => word.startSec >= partStartSec)).toBe(
      true,
    );
    expect(
      words.slice(0, 4).every((word) => word.endSec <= partStartSec + 0.04),
    ).toBe(true);
  });
});
