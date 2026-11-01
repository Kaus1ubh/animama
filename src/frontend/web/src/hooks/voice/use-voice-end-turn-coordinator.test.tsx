// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/lib/logger";
import {
  markSpeechWindowRealStart,
  openSpeechWindow,
  startAcousticTurn,
  type AcousticTurnGateState,
} from "@/lib/voice/acoustic-vad-gate";
import {
  createBrowserSpeechTextBuffers,
  type BrowserSpeechTextBuffers,
} from "@/hooks/voice/browser-recognition-runtime";
import { useVoiceEndTurnCoordinator } from "./use-voice-end-turn-coordinator";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WAIT_MS = 1000;
const TURN = "turn-1";

type Coordinator = ReturnType<typeof useVoiceEndTurnCoordinator>;

const state: {
  gate: AcousticTurnGateState | null;
  buffers: BrowserSpeechTextBuffers | null;
  submitted: { text: string; source: string; probability: number | null }[];
  rotations: string[];
} = { gate: null, buffers: null, submitted: [], rotations: [] };
const result: { current: Coordinator | null } = { current: null };
let root: Root;

function coordinator(): Coordinator {
  if (!result.current) throw new Error("Harness is not mounted");
  return result.current;
}

function Harness() {
  result.current = useVoiceEndTurnCoordinator({
    logger: createLogger("CoordinatorTest"),
    waitMs: WAIT_MS,
    getMode: () => "voice",
    getActiveProvider: () => "browser_external",
    getGateState: () => state.gate,
    getSpeechBuffers: () => state.buffers,
    onSetAvatarPhase: () => {},
    onRotateTurn: (reason) => state.rotations.push(reason),
    getOnVoiceAutoSubmit: () => async (payload) => {
      state.submitted.push({
        text: payload.text,
        source: payload.source,
        probability: payload.probability,
      });
    },
  });
  return null;
}

function committed(text: string): AcousticTurnGateState {
  return { ...startAcousticTurn(TURN), transcriptCommitted: text };
}

function unfinalized(text: string): BrowserSpeechTextBuffers {
  return { ...createBrowserSpeechTextBuffers(TURN), interimText: text };
}

async function endTurn(source?: "acoustic_fallback") {
  await act(async () => {
    await coordinator().queuePendingVoiceEndTurn({
      provider: "browser_external",
      turnId: TURN,
      jobId: "job-1",
      probability: source ? null : 0.9,
      threshold: 0.2,
      latencyMs: 40,
      ...(source ? { source } : {}),
    });
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  state.gate = null;
  state.buffers = null;
  state.submitted = [];
  state.rotations = [];
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("ending a voice turn", () => {
  it("waits for the latest phrase's final result before sending", async () => {
    state.gate = committed("Tell me about");
    state.buffers = unfinalized("the weather tomorrow");
    await endTurn();
    expect(state.submitted).toEqual([]);

    state.gate = committed("Tell me about the weather tomorrow");
    state.buffers = createBrowserSpeechTextBuffers(TURN);
    await act(() =>
      coordinator().submitPendingVoiceEndTurn("transcript_update"),
    );

    expect(state.submitted.map(({ text }) => text)).toEqual([
      "Tell me about the weather tomorrow",
    ]);
    expect(state.rotations).toEqual(["semantic_end_turn"]);
  });

  it("sends words that never finalized when the wait runs out", async () => {
    state.gate = committed("Tell me about");
    state.buffers = unfinalized("the weather tomorrow");
    await endTurn();

    await act(() => vi.advanceTimersByTimeAsync(WAIT_MS));

    expect(state.submitted.map(({ text }) => text)).toEqual([
      "Tell me about the weather tomorrow",
    ]);
  });

  it("lets the owner keep talking when speech resumes before sending", async () => {
    const opened = openSpeechWindow(committed("Tell me about"));
    state.gate = markSpeechWindowRealStart(opened.state);
    await endTurn();
    await act(() => vi.advanceTimersByTimeAsync(WAIT_MS));

    expect(state.submitted).toEqual([]);
    expect(coordinator().hasPendingVoiceEndTurn()).toBe(false);
    expect(state.rotations).toEqual([]);
  });

  it("sends once a sound that was not speech ends", async () => {
    state.gate = openSpeechWindow(committed("Thank you")).state;
    await endTurn();
    await act(() => vi.advanceTimersByTimeAsync(WAIT_MS));
    expect(state.submitted).toEqual([]);

    state.gate = committed("Thank you");
    await act(() =>
      coordinator().submitPendingVoiceEndTurn("speech_window_update"),
    );

    expect(state.submitted.map(({ text }) => text)).toEqual(["Thank you"]);
  });

  it("names a turn ended without a semantic decision", async () => {
    state.gate = committed("Are you there");
    await endTurn("acoustic_fallback");

    expect(state.submitted).toEqual([
      { text: "Are you there", source: "acoustic_fallback", probability: null },
    ]);
  });
});
