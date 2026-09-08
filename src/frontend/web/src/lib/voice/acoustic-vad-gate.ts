export type GateDecisionKind = "committed" | "tentative" | "ignored";

export type TranscriptGateDecision = {
  decision: GateDecisionKind;
  reason:
    | "empty_text"
    | "no_active_window"
    | "window_not_real_speech"
    | "window_real_speech";
  text: string;
  turnId: string;
  windowId: string | null;
};

export type SpeechWindowState = {
  windowId: string;
  openedAtMs: number;
  isRealSpeech: boolean;
  tentativeText: string;
};

export type AcousticTurnGateState = {
  turnId: string;
  startedAtMs: number;
  activeWindow: SpeechWindowState | null;
  transcriptCommitted: string;
  transcriptTentative: string;
  totalAudioSamples: number;
  audioChunkCount: number;
};

export type FinishSpeechWindowResult = {
  state: AcousticTurnGateState;
  accepted: boolean;
  reason: "no_active_window" | "non_real_speech_window" | "real_speech";
  windowId: string | null;
  audioSamples: number;
};

function createId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendText(base: string, value: string): string {
  const next = value.trim();
  if (!next) return base;
  if (!base) return next;
  return `${base} ${next}`;
}

function normalizeSampleCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

export function startAcousticTurn(
  turnId: string,
  startedAtMs = Date.now(),
): AcousticTurnGateState {
  return {
    turnId,
    startedAtMs,
    activeWindow: null,
    transcriptCommitted: "",
    transcriptTentative: "",
    totalAudioSamples: 0,
    audioChunkCount: 0,
  };
}

export function openSpeechWindow(
  state: AcousticTurnGateState,
  openedAtMs = Date.now(),
  windowId = createId("window"),
): { state: AcousticTurnGateState; windowId: string } {
  return {
    state: {
      ...state,
      activeWindow: {
        windowId,
        openedAtMs,
        isRealSpeech: false,
        tentativeText: "",
      },
      transcriptTentative: "",
    },
    windowId,
  };
}

export function markSpeechWindowRealStart(
  state: AcousticTurnGateState,
): AcousticTurnGateState {
  const activeWindow = state.activeWindow;
  if (!activeWindow || activeWindow.isRealSpeech) return state;

  const transcriptCommitted = appendText(
    state.transcriptCommitted,
    activeWindow.tentativeText,
  );

  return {
    ...state,
    transcriptCommitted,
    transcriptTentative: "",
    activeWindow: {
      ...activeWindow,
      isRealSpeech: true,
      tentativeText: "",
    },
  };
}

export function routeTranscriptSegment(
  state: AcousticTurnGateState,
  text: string,
): { state: AcousticTurnGateState; decision: TranscriptGateDecision } {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      state,
      decision: {
        decision: "ignored",
        reason: "empty_text",
        text,
        turnId: state.turnId,
        windowId: state.activeWindow?.windowId ?? null,
      },
    };
  }

  const activeWindow = state.activeWindow;
  if (!activeWindow) {
    return {
      state,
      decision: {
        decision: "ignored",
        reason: "no_active_window",
        text: trimmed,
        turnId: state.turnId,
        windowId: null,
      },
    };
  }

  if (!activeWindow.isRealSpeech) {
    const nextTentative = appendText(activeWindow.tentativeText, trimmed);
    return {
      state: {
        ...state,
        transcriptTentative: nextTentative,
        activeWindow: {
          ...activeWindow,
          tentativeText: nextTentative,
        },
      },
      decision: {
        decision: "tentative",
        reason: "window_not_real_speech",
        text: trimmed,
        turnId: state.turnId,
        windowId: activeWindow.windowId,
      },
    };
  }

  const transcriptCommitted = appendText(state.transcriptCommitted, trimmed);
  return {
    state: {
      ...state,
      transcriptCommitted,
    },
    decision: {
      decision: "committed",
      reason: "window_real_speech",
      text: trimmed,
      turnId: state.turnId,
      windowId: activeWindow.windowId,
    },
  };
}

export function discardSpeechWindowMisfire(
  state: AcousticTurnGateState,
): AcousticTurnGateState {
  if (!state.activeWindow) return state;
  return {
    ...state,
    activeWindow: null,
    transcriptTentative: "",
  };
}

export function finishSpeechWindow(
  state: AcousticTurnGateState,
  audioSamples: number,
): FinishSpeechWindowResult {
  const activeWindow = state.activeWindow;
  const normalizedSamples = normalizeSampleCount(audioSamples);

  if (!activeWindow) {
    return {
      state,
      accepted: false,
      reason: "no_active_window",
      windowId: null,
      audioSamples: normalizedSamples,
    };
  }

  if (!activeWindow.isRealSpeech) {
    return {
      state: {
        ...state,
        activeWindow: null,
        transcriptTentative: "",
      },
      accepted: false,
      reason: "non_real_speech_window",
      windowId: activeWindow.windowId,
      audioSamples: 0,
    };
  }

  return {
    state: {
      ...state,
      activeWindow: null,
      transcriptTentative: "",
      totalAudioSamples: state.totalAudioSamples + normalizedSamples,
      audioChunkCount: state.audioChunkCount + (normalizedSamples > 0 ? 1 : 0),
    },
    accepted: true,
    reason: "real_speech",
    windowId: activeWindow.windowId,
    audioSamples: normalizedSamples,
  };
}
