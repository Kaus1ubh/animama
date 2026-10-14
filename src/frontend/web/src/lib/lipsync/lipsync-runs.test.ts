import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitSpeechPcm,
  emitSpeechUtterance,
} from "@/lib/speech/speech-pcm-tap";
import {
  addLipSyncRunTiming,
  cancelLipSyncRun,
  connectLipSyncRuns,
  endLipSyncRunAudio,
  setLipSyncRunText,
} from "./lipsync-runs";
import {
  startLipSyncEstimateRun,
  startLipSyncRun,
} from "./lipsync-worker-client";

vi.mock("./lipsync-worker-client", () => ({
  startLipSyncEstimateRun: vi.fn(() => ({
    startUtterance: vi.fn(),
    addBoundary: vi.fn(),
    endUtterance: vi.fn(),
    cancel: vi.fn(),
  })),
  startLipSyncRun: vi.fn(() => ({
    setText: vi.fn(),
    startPart: vi.fn(),
    pushPcm: vi.fn(),
    addTiming: vi.fn(),
    endAudio: vi.fn(),
    cancel: vi.fn(),
  })),
}));

const started = () => vi.mocked(startLipSyncRun).mock.results;
const handle = (index: number) =>
  started()[index]!.value as ReturnType<typeof startLipSyncRun>;
const pcm = new Int16Array(240);

describe("lip-sync runs", () => {
  let disconnect: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    disconnect = connectLipSyncRuns({ onResponse: vi.fn() });
  });
  afterEach(() => disconnect());

  it("starts a run with its first audio and replays what came before", () => {
    setLipSyncRunText("run-1", "Hi there.", false);
    addLipSyncRunTiming("run-1", [{ char: "H", startSec: 0, endSec: 0.1 }]);
    expect(startLipSyncRun).not.toHaveBeenCalled();

    emitSpeechPcm({
      runId: "run-1",
      provider: "elevenlabs",
      sampleRate: 24_000,
      pcm,
    });
    emitSpeechPcm({
      runId: "run-1",
      provider: "elevenlabs",
      sampleRate: 24_000,
      pcm,
    });
    setLipSyncRunText("run-1", "Hi there.", true);
    endLipSyncRunAudio("run-1");
    endLipSyncRunAudio("run-1");

    expect(startLipSyncRun).toHaveBeenCalledTimes(1);
    expect(startLipSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", sampleRate: 24_000 }),
    );
    const run = handle(0);
    expect(vi.mocked(run.setText).mock.calls).toEqual([
      ["Hi there.", false],
      ["Hi there.", true],
    ]);
    expect(run.addTiming).toHaveBeenCalledTimes(1);
    expect(run.pushPcm).toHaveBeenCalledTimes(2);
    expect(run.endAudio).toHaveBeenCalledTimes(1);
  });

  it("starts a part before the audio that speaks it", () => {
    emitSpeechPcm({
      runId: "run-1",
      provider: "gemini",
      sampleRate: 24_000,
      pcm,
      partText: "Hello.",
    });
    const run = handle(0);
    expect(run.startPart).toHaveBeenCalledWith("Hello.");
    expect(vi.mocked(run.startPart).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(run.pushPcm).mock.invocationCallOrder[0]!,
    );
    // The reply's growing text is not sent once parts name theirs.
    setLipSyncRunText("run-1", "Hello. How are", false);
    expect(run.setText).not.toHaveBeenCalled();
  });

  it("estimates browser speech from its utterances, on the run clock", () => {
    emitSpeechUtterance({
      runId: "run-1",
      type: "start",
      text: "Hello.",
      atSec: 100,
    });
    emitSpeechUtterance({
      runId: "run-1",
      type: "boundary",
      charIndex: 0,
      atSec: 100.05,
    });
    emitSpeechUtterance({ runId: "run-1", type: "end", atSec: 100.6 });
    emitSpeechUtterance({
      runId: "run-1",
      type: "start",
      text: "Bye.",
      atSec: 100.8,
    });

    expect(startLipSyncEstimateRun).toHaveBeenCalledTimes(1);
    const run = vi.mocked(startLipSyncEstimateRun).mock.results[0]!
      .value as ReturnType<typeof startLipSyncEstimateRun>;
    expect(vi.mocked(run.startUtterance).mock.calls).toEqual([
      ["Hello.", 0],
      ["Bye.", expect.closeTo(0.8, 6)],
    ]);
    expect(run.addBoundary).toHaveBeenCalledWith(0, expect.closeTo(0.05, 6));
    expect(run.endUtterance).toHaveBeenCalledWith(expect.closeTo(0.6, 6));

    cancelLipSyncRun("run-1");
    expect(run.cancel).toHaveBeenCalled();
  });

  it("restarts planning when the provider changes, and stops on cancel", () => {
    setLipSyncRunText("run-1", "Hi.", true);
    emitSpeechPcm({
      runId: "run-1",
      provider: "elevenlabs",
      sampleRate: 24_000,
      pcm,
    });
    emitSpeechPcm({
      runId: "run-1",
      provider: "pocket",
      sampleRate: 24_000,
      pcm,
    });

    expect(startLipSyncRun).toHaveBeenCalledTimes(2);
    expect(handle(0).cancel).toHaveBeenCalled();
    expect(handle(1).setText).toHaveBeenCalledWith("Hi.", true);

    cancelLipSyncRun("run-1");
    expect(handle(1).cancel).toHaveBeenCalled();
  });
});
