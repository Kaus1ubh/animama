import { create } from "zustand";

import type { AcousticVadEvent, RuntimeTurnId } from "@/lib/types/voice-types";
import type {
  GateDecisionKind,
  TranscriptGateDecision,
} from "@/lib/voice/acoustic-vad-gate";

const MAX_EVENT_HISTORY = 80;
const MAX_GATE_DECISION_HISTORY = 80;
const MAX_SMART_TURN_EVENT_HISTORY = 80;

export type VadDebugStatus =
  | "idle"
  | "initializing"
  | "running"
  | "stopped"
  | "error";

export type SmartTurnDebugStatus =
  | "idle"
  | "loading"
  | "ready"
  | "running"
  | "stopped"
  | "error";

export type SmartTurnDebugEventType =
  | "worker_load_start"
  | "worker_ready"
  | "worker_error"
  | "job_queued"
  | "job_running"
  | "job_superseded"
  | "job_completed"
  | "job_error"
  | "auto_submit"
  | "auto_submit_skipped"
  | "buffer_reset";

export type VadDebugEvent = {
  id: string;
  turnId: RuntimeTurnId;
  windowId: string | null;
  provider: string | null;
  type: AcousticVadEvent["type"];
  createdAtMs: number;
  audioSamples: number | null;
};

export type VadGateDecisionDebug = {
  id: string;
  turnId: RuntimeTurnId;
  windowId: string | null;
  createdAtMs: number;
  decision: GateDecisionKind;
  reason: TranscriptGateDecision["reason"];
  text: string;
  chars: number;
  isFinal: boolean;
};

export type VadFrameDebug = {
  createdAtMs: number;
  isSpeech: number;
  notSpeech: number;
};

export type SmartTurnLatestDecisionDebug = {
  turnId: RuntimeTurnId;
  jobId: string;
  decision: "end_turn" | "continue";
  probability: number | null;
  threshold: number;
  latencyMs: number | null;
  createdAtMs: number;
};

export type SmartTurnDebugAudio = {
  sampleRateHz: number;
  samples: Float32Array;
};

export type SmartTurnEventDebug = {
  id: string;
  turnId: RuntimeTurnId | null;
  jobId: string | null;
  provider: string | null;
  type: SmartTurnDebugEventType;
  createdAtMs: number;
  details: string | null;
  probability?: number | null;
  audio?: SmartTurnDebugAudio | null;
};

type VoiceVadDebugStoreState = {
  status: VadDebugStatus;
  error: string | null;
  provider: string | null;
  turnId: RuntimeTurnId | null;
  windowId: string | null;
  windowIsRealSpeech: boolean;
  committedChars: number;
  tentativeChars: number;
  rollingAudioSamples: number;
  latestFrame: VadFrameDebug | null;
  events: VadDebugEvent[];
  gateDecisions: VadGateDecisionDebug[];
  smartTurnEnabled: boolean;
  smartTurnStatus: SmartTurnDebugStatus;
  smartTurnError: string | null;
  smartTurnActiveJobId: string | null;
  smartTurnBufferedSamples: number;
  smartTurnBufferedAudio: SmartTurnDebugAudio | null;
  smartTurnSupersededJobs: number;
  smartTurnLatestDecision: SmartTurnLatestDecisionDebug | null;
  smartTurnEvents: SmartTurnEventDebug[];
  startSession: (args: { provider: string; turnId: RuntimeTurnId }) => void;
  setTurnContext: (args: { provider: string; turnId: RuntimeTurnId }) => void;
  stopSession: () => void;
  setStatus: (status: VadDebugStatus) => void;
  setError: (error: string | null) => void;
  setActiveWindow: (windowId: string) => void;
  setWindowRealSpeech: (isRealSpeech: boolean) => void;
  clearActiveWindow: () => void;
  setTranscriptStats: (args: {
    committedChars: number;
    tentativeChars: number;
  }) => void;
  appendAudioSamples: (sampleCount: number) => void;
  setRollingAudioSamples: (sampleCount: number) => void;
  setLatestFrame: (frame: VadFrameDebug) => void;
  pushEvent: (event: Omit<VadDebugEvent, "id">) => void;
  pushGateDecision: (decision: Omit<VadGateDecisionDebug, "id">) => void;
  setSmartTurnEnabled: (enabled: boolean) => void;
  setSmartTurnStatus: (status: SmartTurnDebugStatus) => void;
  setSmartTurnError: (error: string | null) => void;
  setSmartTurnActiveJob: (jobId: string | null) => void;
  setSmartTurnBufferedSamples: (sampleCount: number) => void;
  setSmartTurnBufferedAudio: (audio: SmartTurnDebugAudio | null) => void;
  incrementSmartTurnSuperseded: () => void;
  setSmartTurnLatestDecision: (
    decision: SmartTurnLatestDecisionDebug | null,
  ) => void;
  pushSmartTurnEvent: (event: Omit<SmartTurnEventDebug, "id">) => void;
  resetSmartTurn: () => void;
  reset: () => void;
};

function pushBounded<T>(items: T[], next: T, max: number): T[] {
  const updated = [next, ...items];
  if (updated.length > max) {
    updated.length = max;
  }
  return updated;
}

function createId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneSmartTurnDebugAudio(
  audio: SmartTurnDebugAudio | null | undefined,
): SmartTurnDebugAudio | null {
  if (!audio) return null;
  const sampleRateHz = Number.isFinite(audio.sampleRateHz)
    ? Math.max(1, Math.floor(audio.sampleRateHz))
    : 16000;
  const samples = new Float32Array(audio.samples);
  return { sampleRateHz, samples };
}

const INITIAL_STATE = {
  status: "idle" as VadDebugStatus,
  error: null,
  provider: null,
  turnId: null,
  windowId: null,
  windowIsRealSpeech: false,
  committedChars: 0,
  tentativeChars: 0,
  rollingAudioSamples: 0,
  latestFrame: null,
  events: [] as VadDebugEvent[],
  gateDecisions: [] as VadGateDecisionDebug[],
  smartTurnEnabled: false,
  smartTurnStatus: "idle" as SmartTurnDebugStatus,
  smartTurnError: null,
  smartTurnActiveJobId: null,
  smartTurnBufferedSamples: 0,
  smartTurnBufferedAudio: null as SmartTurnDebugAudio | null,
  smartTurnSupersededJobs: 0,
  smartTurnLatestDecision: null as SmartTurnLatestDecisionDebug | null,
  smartTurnEvents: [] as SmartTurnEventDebug[],
};

export const useVoiceVadDebugStore = create<VoiceVadDebugStoreState>((set) => ({
  ...INITIAL_STATE,

  startSession: ({ provider, turnId }) =>
    set({
      status: "initializing",
      error: null,
      provider,
      turnId,
      windowId: null,
      windowIsRealSpeech: false,
      committedChars: 0,
      tentativeChars: 0,
      rollingAudioSamples: 0,
      latestFrame: null,
      events: [],
      gateDecisions: [],
      smartTurnEnabled: false,
      smartTurnStatus: "idle",
      smartTurnError: null,
      smartTurnActiveJobId: null,
      smartTurnBufferedSamples: 0,
      smartTurnBufferedAudio: null,
      smartTurnSupersededJobs: 0,
      smartTurnLatestDecision: null,
      smartTurnEvents: [],
    }),

  setTurnContext: ({ provider, turnId }) =>
    set((state) => ({
      provider,
      turnId,
      windowId: null,
      windowIsRealSpeech: false,
      committedChars: 0,
      tentativeChars: 0,
      rollingAudioSamples: 0,
      latestFrame: null,
      smartTurnActiveJobId: null,
      smartTurnBufferedSamples: 0,
      smartTurnBufferedAudio: null,
      smartTurnLatestDecision: null,
      status: state.status === "error" ? "error" : "running",
      smartTurnStatus:
        state.smartTurnStatus === "error"
          ? "error"
          : state.smartTurnEnabled
            ? "ready"
            : "idle",
    })),

  stopSession: () =>
    set((state) => ({
      status: state.status === "error" ? "error" : "stopped",
      turnId: null,
      windowId: null,
      windowIsRealSpeech: false,
      latestFrame: null,
      smartTurnEnabled: false,
      smartTurnStatus: state.smartTurnStatus === "error" ? "error" : "stopped",
      smartTurnActiveJobId: null,
      smartTurnBufferedSamples: 0,
      smartTurnBufferedAudio: null,
    })),

  setStatus: (status) => set({ status }),

  setError: (error) =>
    set((state) => ({
      error,
      status: error ? "error" : state.status,
    })),

  setActiveWindow: (windowId) =>
    set({
      windowId,
      windowIsRealSpeech: false,
      tentativeChars: 0,
    }),

  setWindowRealSpeech: (isRealSpeech) =>
    set({ windowIsRealSpeech: isRealSpeech }),

  clearActiveWindow: () =>
    set({
      windowId: null,
      windowIsRealSpeech: false,
      tentativeChars: 0,
    }),

  setTranscriptStats: ({ committedChars, tentativeChars }) =>
    set({
      committedChars: Math.max(0, committedChars),
      tentativeChars: Math.max(0, tentativeChars),
    }),

  appendAudioSamples: (sampleCount) =>
    set((state) => ({
      rollingAudioSamples:
        state.rollingAudioSamples + Math.max(0, Math.floor(sampleCount)),
    })),

  setRollingAudioSamples: (sampleCount) =>
    set({
      rollingAudioSamples: Math.max(0, Math.floor(sampleCount)),
    }),

  setLatestFrame: (frame) =>
    set({
      latestFrame: {
        createdAtMs: frame.createdAtMs,
        isSpeech: frame.isSpeech,
        notSpeech: frame.notSpeech,
      },
    }),

  pushEvent: (event) =>
    set((state) => ({
      events: pushBounded(
        state.events,
        {
          ...event,
          id: createId("vad-event"),
        },
        MAX_EVENT_HISTORY,
      ),
    })),

  pushGateDecision: (decision) =>
    set((state) => ({
      gateDecisions: pushBounded(
        state.gateDecisions,
        {
          ...decision,
          id: createId("vad-gate"),
        },
        MAX_GATE_DECISION_HISTORY,
      ),
    })),

  setSmartTurnEnabled: (enabled) =>
    set((state) => ({
      smartTurnEnabled: enabled,
      smartTurnStatus: enabled
        ? state.smartTurnStatus === "error"
          ? "error"
          : "loading"
        : "idle",
      smartTurnError: enabled ? state.smartTurnError : null,
      smartTurnActiveJobId: null,
      smartTurnBufferedSamples: enabled ? state.smartTurnBufferedSamples : 0,
      smartTurnBufferedAudio: enabled ? state.smartTurnBufferedAudio : null,
      smartTurnSupersededJobs: enabled ? state.smartTurnSupersededJobs : 0,
      smartTurnLatestDecision: enabled ? state.smartTurnLatestDecision : null,
      smartTurnEvents: enabled ? state.smartTurnEvents : [],
    })),

  setSmartTurnStatus: (status) =>
    set({
      smartTurnStatus: status,
    }),

  setSmartTurnError: (error) =>
    set((state) => ({
      smartTurnError: error,
      smartTurnStatus: error ? "error" : state.smartTurnStatus,
    })),

  setSmartTurnActiveJob: (jobId) =>
    set({
      smartTurnActiveJobId: jobId,
    }),

  setSmartTurnBufferedSamples: (sampleCount) =>
    set((state) => {
      const nextSamples = Math.max(0, Math.floor(sampleCount));
      return {
        smartTurnBufferedSamples: nextSamples,
        smartTurnBufferedAudio:
          nextSamples === 0 ? null : state.smartTurnBufferedAudio,
      };
    }),

  setSmartTurnBufferedAudio: (audio) =>
    set(() => {
      const clonedAudio = cloneSmartTurnDebugAudio(audio);
      return {
        smartTurnBufferedAudio: clonedAudio,
        smartTurnBufferedSamples: clonedAudio ? clonedAudio.samples.length : 0,
      };
    }),

  incrementSmartTurnSuperseded: () =>
    set((state) => ({
      smartTurnSupersededJobs: state.smartTurnSupersededJobs + 1,
    })),

  setSmartTurnLatestDecision: (decision) =>
    set({
      smartTurnLatestDecision: decision,
    }),

  pushSmartTurnEvent: (event) =>
    set((state) => ({
      smartTurnEvents: pushBounded(
        state.smartTurnEvents,
        {
          ...event,
          audio: cloneSmartTurnDebugAudio(event.audio),
          id: createId("smart-turn"),
        },
        MAX_SMART_TURN_EVENT_HISTORY,
      ),
    })),

  resetSmartTurn: () =>
    set((state) => ({
      smartTurnEnabled: false,
      smartTurnStatus: "idle",
      smartTurnError: null,
      smartTurnActiveJobId: null,
      smartTurnBufferedSamples: 0,
      smartTurnBufferedAudio: null,
      smartTurnSupersededJobs: 0,
      smartTurnLatestDecision: null,
      smartTurnEvents: [],
      status: state.status,
    })),

  reset: () => set({ ...INITIAL_STATE }),
}));
