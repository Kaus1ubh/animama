import { afterEach, describe, expect, it, vi } from "vitest";

import { buildVisemeAssetsFromRaw } from "@/lib/avatar/viseme-worker-client";
import type { VowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import { startLipSyncRun } from "@/lib/lipsync/lipsync-worker-client";
import type { LipSyncWorkerResponse } from "@/lib/lipsync/worker-protocol";
import {
  ALIGNED_LIPSYNC_PLAN_SOURCE_ID,
  ESTIMATED_LIPSYNC_PLAN_SOURCE_ID,
  lipSyncPlanSources,
  mouthOpennessCurve,
  registerLipSyncPlanSource,
  type LipSyncPlanInputs,
} from "./lipsync-plan-sources";
import { buildSpeechTimingEvidence } from "./speech-timing-evidence";

vi.mock("@/lib/avatar/viseme-worker-client", () => ({
  buildVisemeAssetsFromRaw: vi.fn(),
}));
vi.mock("@/lib/lipsync/lipsync-worker-client", () => ({
  startLipSyncRun: vi.fn(),
}));

function segmentWith(
  frames: Array<[number, [number, number, number, number, number]]>,
): VowelVisemeLipSyncSegment {
  return {
    segmentId: "segment-1",
    meta: { run_id: "run-1", segment_id: "segment-1" },
    frames: frames.map(([timeSec, values], index) => ({
      frame_index: index,
      time_sec: timeSec,
      format: "vowel5",
      values,
    })),
    frameCount: frames.length,
    durationMs: 1000,
    durationSec: 1,
    fps: 60,
  };
}

const timing = [
  { char: "H", startSec: 0, endSec: 0.1 },
  { char: "i", startSec: 0.1, endSec: 0.2 },
];
const inputs: LipSyncPlanInputs = {
  runId: "run-1",
  phonemizedText: [["h", "aɪ"]],
  tokenizedText: "Hi",
  fps: 60,
  audioDurationSec: 0.4,
  timing,
  evidence: buildSpeechTimingEvidence(timing),
  audio: { chunks: [new Int16Array(4800)], sampleRate: 24_000 },
  text: "Hi",
  parts: [],
};

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
  vi.mocked(buildVisemeAssetsFromRaw).mockReset();
  vi.mocked(startLipSyncRun).mockReset();
  vi.unstubAllGlobals();
});

describe("lip-sync plan sources", () => {
  it("lists gruut's estimate and the aligned planner, then each registered source", () => {
    expect(lipSyncPlanSources().map((source) => source.id)).toEqual([
      ESTIMATED_LIPSYNC_PLAN_SOURCE_ID,
      ALIGNED_LIPSYNC_PLAN_SOURCE_ID,
    ]);

    unregister = registerLipSyncPlanSource({
      id: "timing-test",
      label: "Timing (test)",
      build: async () => null,
    });

    expect(lipSyncPlanSources().map((source) => source.label)).toEqual([
      "Estimated (today)",
      "Aligned (new)",
      "Timing (test)",
    ]);
    unregister();
    unregister = null;
    expect(lipSyncPlanSources()).toHaveLength(2);
  });

  it("replaces a source registered again under its id", () => {
    unregister = registerLipSyncPlanSource({
      id: "timing-test",
      label: "First",
      build: async () => null,
    });
    const unregisterSecond = registerLipSyncPlanSource({
      id: "timing-test",
      label: "Second",
      build: async () => null,
    });

    expect(lipSyncPlanSources().map((source) => source.label)).toEqual([
      "Estimated (today)",
      "Aligned (new)",
      "Second",
    ]);
    unregisterSecond();
  });

  it("builds the estimated plan with today's planner at the played length", async () => {
    const segment = segmentWith([[0, [1, 0, 0, 0, 0]]]);
    vi.mocked(buildVisemeAssetsFromRaw).mockResolvedValue({
      segment,
    } as Awaited<ReturnType<typeof buildVisemeAssetsFromRaw>>);
    const [estimated] = lipSyncPlanSources();

    await expect(estimated.build(inputs)).resolves.toEqual({ segment });
    expect(buildVisemeAssetsFromRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "actual_prestart",
        phonemizedText: inputs.phonemizedText,
        tokenizedText: "Hi",
        fps: 60,
        targetDurationSec: 0.4,
      }),
    );
  });

  it("replans the captured audio in the lip-sync worker", async () => {
    vi.stubGlobal("Worker", class {});
    const calls: string[] = [];
    let respond: ((response: LipSyncWorkerResponse) => void) | null = null;
    vi.mocked(startLipSyncRun).mockImplementation(({ onResponse }) => {
      respond = onResponse;
      return {
        setText: (text, final) => calls.push(`text ${text} ${final}`),
        startPart: (text) => calls.push(`part ${text}`),
        pushPcm: (pcm) => calls.push(`pcm ${pcm.length}`),
        addTiming: (chars) => calls.push(`timing ${chars.length}`),
        endAudio: () => calls.push("end"),
        cancel: () => calls.push("cancel"),
      };
    });
    const aligned = lipSyncPlanSources()[1]!;
    const plan = aligned.build({
      ...inputs,
      audio: {
        chunks: [new Int16Array(100), new Int16Array(200)],
        sampleRate: 24_000,
      },
      parts: [
        { sample: 0, text: "Hello." },
        { sample: 100, text: "Bye." },
      ],
    });
    expect(calls).toEqual([
      "timing 2",
      "part Hello.",
      "pcm 100",
      "part Bye.",
      "pcm 200",
      "end",
    ]);

    // Two updates: all 31 frames, then the last 11 revised.
    const update = (fromFrame: number, complete: boolean) => ({
      type: "plan" as const,
      runId: "x",
      seq: 1,
      fromFrame,
      frames: new Float32Array((31 - fromFrame) * 5).fill(complete ? 0.5 : 0.2),
      frameCount: 31,
      events: [],
      gestures: { words: [], beats: [], phrases: [] },
      complete,
      fallback: null,
      audioSec: 0.5,
      cpuMs: 1,
    });
    respond!(update(0, false));
    respond!(update(20, true));
    const result = (await plan)!;
    expect(result.cpuMsPerAudioSec).toBe(2);
    expect(result.segment.frames).toHaveLength(31);
    expect((result.segment.frames[0]!.values as number[])[0]).toBeCloseTo(0.2);
    expect((result.segment.frames[30]!.values as number[])[0]).toBeCloseTo(0.5);
    expect(calls.at(-1)).toBe("cancel");
  });

  it("has no aligned plan without a worker", async () => {
    await expect(lipSyncPlanSources()[1]!.build(inputs)).resolves.toBeNull();
    expect(startLipSyncRun).not.toHaveBeenCalled();
  });

  it("has no estimated plan without phonemes", async () => {
    const [estimated] = lipSyncPlanSources();

    await expect(
      estimated.build({ ...inputs, phonemizedText: null }),
    ).resolves.toBeNull();
    expect(buildVisemeAssetsFromRaw).not.toHaveBeenCalled();
  });
});

describe("mouth openness", () => {
  it("weights open vowels above closed ones", () => {
    const curve = mouthOpennessCurve(
      segmentWith([
        [0, [0, 0, 0, 0, 0]],
        [0.1, [1, 0, 0, 0, 0]],
        [0.2, [0, 0, 1, 0, 0]],
        [0.3, [0, 0, 0, 1, 0]],
      ]),
    );

    expect(curve.map((point) => point.timeSec)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(curve[0].openness).toBe(0);
    expect(curve[1].openness).toBe(1);
    expect(curve[2].openness).toBeLessThan(curve[3].openness);
    expect(curve[3].openness).toBeLessThan(curve[1].openness);
  });

  it("skips frames without vowel values", () => {
    const segment = segmentWith([[0, [1, 0, 0, 0, 0]]]);
    segment.frames.push({ time_sec: 0.5, values: "bad" });

    expect(mouthOpennessCurve(segment)).toEqual([{ timeSec: 0, openness: 1 }]);
  });
});
