"use client";

import { create } from "zustand";

import { registerPrivateStateReset } from "@/app/runtime/private-module-state";
import type { LipSyncCapture } from "@/lib/lipsync/capture-file";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import {
  addSpeechPcmListener,
  type SpeechPcmTapEvent,
} from "@/lib/speech/speech-pcm-tap";
import {
  useAvatarLipSyncBridgeStore,
  type PlannedLipSyncStats,
  type RawVisemeInputs,
} from "./avatar-lipsync-bridge-store";

/** The longest audio one capture keeps. */
export const LIPSYNC_DEBUG_MAX_SECONDS = 90;

/**
 * The latest spoken run captured for the debug panel's Lip-sync view (or a
 * capture file loaded in development): its audio and what the planners need,
 * copied before the bridge clears the run.
 */
export type LipSyncDebugCapture = {
  /** A live run, or a capture file. */
  origin: "live" | "file";
  runId: string;
  provider: SpeechPcmTapEvent["provider"];
  sampleRate: number;
  chunks: Int16Array[];
  samples: number;
  /** Whether audio beyond the cap was dropped. */
  truncated: boolean;
  timing: TimedChar[];
  /** The text sent to the voice, once the run's text is complete. */
  text: string | null;
  /** Speech parts (Gemini) by the sample their audio starts at. */
  parts: Array<{ sample: number; text: string }>;
  inputs: RawVisemeInputs | null;
  /** How the live planner did on the run. */
  plannerStats: PlannedLipSyncStats | null;
  /** The played length, known once the provider has sent all the audio. */
  audioDurationSec: number | null;
  /** Whether the bridge has seen this run, so its clear means playback ended. */
  seenInBridge: boolean;
  /**
   * Whether the run's playback has ended: the bridge clears a run when its
   * audio stops, which is later than the stream's end.
   */
  playbackEnded: boolean;
};

type LipSyncDebugState = {
  capturing: boolean;
  capture: LipSyncDebugCapture | null;
  /** Capture each new realtime run while the debug panel is enabled. */
  startCapture: () => void;
  /** Stop capturing and drop the captured run. */
  stopCapture: () => void;
  /** Show a capture file in place of the latest run. */
  loadCapture: (capture: LipSyncCapture) => void;
  reset: () => void;
};

let unsubscribeBridge: (() => void) | null = null;

export const useLipSyncDebugStore = create<LipSyncDebugState>((set, get) => {
  /** Copy the captured run's planner inputs, timing and length from the bridge. */
  const syncFromBridge = (
    bridge: ReturnType<typeof useAvatarLipSyncBridgeStore.getState>,
  ) => {
    const capture = get().capture;
    if (!capture || capture.origin === "file") return;
    const inputs = bridge.rawVisemeInputsByRun[capture.runId];
    const timing = bridge.providerSpeechTimingByRun[capture.runId]?.chars;
    const audioDuration = bridge.speechAudioDurationsByRun[capture.runId];
    const text = bridge.speechTextByRun[capture.runId];
    const plannerStats = bridge.plannerStatsByRun[capture.runId];
    const inBridge = Boolean(
      inputs ||
      timing ||
      audioDuration ||
      bridge.speechAudioStartsByRun[capture.runId],
    );
    // A cleared run keeps what was copied before.
    const next = {
      inputs: inputs ?? capture.inputs,
      timing: timing ?? capture.timing,
      text: text ?? capture.text,
      plannerStats: plannerStats ?? capture.plannerStats,
      audioDurationSec:
        audioDuration?.audioDurationSec ?? capture.audioDurationSec,
      seenInBridge: capture.seenInBridge || inBridge,
      playbackEnded:
        capture.playbackEnded || (capture.seenInBridge && !inBridge),
    };
    if (
      (Object.keys(next) as Array<keyof typeof next>).every(
        (key) => next[key] === capture[key],
      )
    )
      return;
    set({ capture: { ...capture, ...next } });
  };

  const acceptPcm = (event: SpeechPcmTapEvent) => {
    let capture = get().capture;
    if (!capture || capture.runId !== event.runId) {
      // Keep only the latest run.
      capture = {
        origin: "live",
        runId: event.runId,
        provider: event.provider,
        sampleRate: event.sampleRate,
        chunks: [],
        samples: 0,
        truncated: false,
        timing: [],
        text: null,
        parts: [],
        inputs: null,
        plannerStats: null,
        audioDurationSec: null,
        seenInBridge: false,
        playbackEnded: false,
      };
      set({ capture });
      syncFromBridge(useAvatarLipSyncBridgeStore.getState());
      capture = get().capture ?? capture;
    }
    const room =
      LIPSYNC_DEBUG_MAX_SECONDS * capture.sampleRate - capture.samples;
    if (room <= 0) {
      if (!capture.truncated) set({ capture: { ...capture, truncated: true } });
      return;
    }
    // Keep 16-bit samples, whatever the runtime played.
    const chunk =
      event.pcm instanceof Int16Array
        ? event.pcm.slice(0, room)
        : Int16Array.from(event.pcm.subarray(0, room), (value) =>
            Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
          );
    set({
      capture: {
        ...capture,
        chunks: [...capture.chunks, chunk],
        samples: capture.samples + chunk.length,
        truncated: chunk.length < event.pcm.length,
        parts: event.partText
          ? [
              ...capture.parts,
              { sample: capture.samples, text: event.partText },
            ]
          : capture.parts,
      },
    });
  };

  let stopListening: (() => void) | null = null;

  const stopCapture = () => {
    stopListening?.();
    stopListening = null;
    unsubscribeBridge?.();
    unsubscribeBridge = null;
    set({ capturing: false, capture: null });
  };

  return {
    capturing: false,
    capture: null,
    startCapture: () => {
      if (get().capturing) return;
      stopListening = addSpeechPcmListener(acceptPcm);
      unsubscribeBridge = useAvatarLipSyncBridgeStore.subscribe(syncFromBridge);
      set({ capturing: true });
    },
    stopCapture,
    loadCapture: (file) =>
      set({
        capture: {
          origin: "file",
          runId: file.id,
          provider: file.provider,
          sampleRate: file.sampleRate,
          chunks: [file.pcm],
          samples: file.pcm.length,
          truncated: false,
          timing: file.timing,
          text: file.text,
          parts: file.parts,
          inputs: file.estimated ? { ...file.estimated, fps: 60 } : null,
          plannerStats: null,
          audioDurationSec: file.pcm.length / file.sampleRate,
          seenInBridge: false,
          playbackEnded: true,
        },
      }),
    reset: stopCapture,
  };
});

// The capture holds a reply's audio and text, which end with the session.
registerPrivateStateReset(() => useLipSyncDebugStore.getState().reset());
