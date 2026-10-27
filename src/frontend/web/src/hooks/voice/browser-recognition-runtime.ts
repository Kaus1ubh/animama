"use client";

import type { Logger } from "@/lib/logger";
import type {
  BrowserSpeechRecognition,
  BrowserSpeechRecognitionErrorEvent,
  BrowserSpeechRecognitionEvent,
} from "@/lib/speech/stt-provider";
import {
  routeTranscriptSegment,
  type AcousticTurnGateState,
} from "@/lib/voice/acoustic-vad-gate";
import { joinSpeechText } from "@/lib/speech/speech-text";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import type { VadGateDecisionDebug } from "@/stores/voice-vad-debug-store";

type BrowserSttProvider = "browser_external" | "browser_local";
type DictationMode = "dictation" | "voice";
export type BrowserRecognitionStopReason = "pause" | "stop" | null;
type ClosedRealSpeechWindow = {
  turnId: string;
  windowId: string;
  closedAtMs: number;
  expiresAtMs: number;
};
const DEFAULT_LOG_TRANSCRIPT_MAX_CHARS = 120;

export type BrowserSpeechTextBuffers = {
  turnId: string;
  finalText: string;
  interimText: string;
  updatedAtMs: number;
  lastFinalAtMs: number | null;
  lastInterimAtMs: number | null;
};

type BrowserSpeechCollectedResult = {
  index: number;
  isFinal: boolean;
  alternatives: number;
  transcript: string;
};

type CollectBrowserSpeechSegmentsOptions = {
  onCollected?: (payload: {
    resultIndex: number;
    resultCount: number;
    finalCount: number;
    interimCount: number;
    changedResults: BrowserSpeechCollectedResult[];
  }) => void;
};

type UpdateBrowserSpeechTextBuffersArgs = {
  current: BrowserSpeechTextBuffers | null;
  turnId: string;
  finalSegments: string[];
  interimSegments: string[];
  nowMs?: number;
};

type ConfigureBrowserRecognitionLifecycleArgs = {
  recognition: BrowserSpeechRecognition;
  provider: BrowserSttProvider;
  logger: Logger;
  toErrorMessage: (errorCode: string | undefined) => string;
  onResult: (event: BrowserSpeechRecognitionEvent) => void;
  onError: (error: Error) => void;
  isStopRequested: () => boolean;
  setStopRequested: (value: boolean) => void;
  getStopReason: () => BrowserRecognitionStopReason;
  setStopReason: (reason: BrowserRecognitionStopReason) => void;
  onEnded: (args: {
    requestedStop: boolean;
    stopReason: BrowserRecognitionStopReason;
  }) => void;
};

type ProcessBrowserRecognitionResultArgs = {
  event: BrowserSpeechRecognitionEvent;
  provider: BrowserSttProvider;
  fallbackTurnId: string;
  logger: Logger;
  mode: DictationMode;
  currentTurnId: string | null;
  gateState: AcousticTurnGateState | null;
  browserSpeechTextBuffers: BrowserSpeechTextBuffers | null;
  lateFinalTranscriptGraceMs: number;
  resolveLateFinalWindow: (
    turnId: string,
    nowMs: number,
  ) => ClosedRealSpeechWindow | null;
  pushGateDecision: (decision: Omit<VadGateDecisionDebug, "id">) => void;
  onCommittedSegment: (args: { text: string; turnId: string }) => void;
  syncGateDebugStats: () => void;
};

type ProcessBrowserRecognitionResultOutput = {
  nextGateState: AcousticTurnGateState | null;
  nextBuffers: BrowserSpeechTextBuffers | null;
};

export function appendTranscript(base: string, next: string): string {
  return joinSpeechText(base, next.trim());
}

export function truncateTranscriptForLog(
  value: string,
  maxChars = DEFAULT_LOG_TRANSCRIPT_MAX_CHARS,
): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

export function collectBrowserSpeechSegments(
  event: BrowserSpeechRecognitionEvent,
  options?: CollectBrowserSpeechSegmentsOptions,
): {
  finalSegments: string[];
  interimSegments: string[];
} {
  const finalSegments: string[] = [];
  const interimSegments: string[] = [];
  const changedResults: BrowserSpeechCollectedResult[] = [];
  const startIndex =
    typeof event.resultIndex === "number" ? event.resultIndex : 0;

  for (let i = startIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (!result || result.length === 0) continue;
    const transcript = result[0]?.transcript?.trim();
    if (!transcript) continue;

    changedResults.push({
      index: i,
      isFinal: Boolean(result.isFinal),
      alternatives: result.length,
      transcript: truncateTranscriptForLog(transcript),
    });

    if (result.isFinal) {
      finalSegments.push(transcript);
      continue;
    }

    interimSegments.push(transcript);
  }

  options?.onCollected?.({
    resultIndex: startIndex,
    resultCount: event.results.length,
    finalCount: finalSegments.length,
    interimCount: interimSegments.length,
    changedResults,
  });

  return { finalSegments, interimSegments };
}

export function createBrowserSpeechTextBuffers(
  turnId: string,
  nowMs = Date.now(),
): BrowserSpeechTextBuffers {
  return {
    turnId,
    finalText: "",
    interimText: "",
    updatedAtMs: nowMs,
    lastFinalAtMs: null,
    lastInterimAtMs: null,
  };
}

export function updateBrowserSpeechTextBuffers({
  current,
  turnId,
  finalSegments,
  interimSegments,
  nowMs = Date.now(),
}: UpdateBrowserSpeechTextBuffersArgs): BrowserSpeechTextBuffers {
  const nextBuffers =
    current && current.turnId === turnId
      ? { ...current }
      : createBrowserSpeechTextBuffers(turnId, nowMs);

  if (finalSegments.length > 0) {
    const joinedFinal = finalSegments.reduce(appendTranscript, "");
    if (joinedFinal) {
      nextBuffers.finalText = appendTranscript(
        nextBuffers.finalText,
        joinedFinal,
      );
      nextBuffers.lastFinalAtMs = nowMs;
    }
  }

  if (interimSegments.length > 0) {
    nextBuffers.interimText = interimSegments.reduce(appendTranscript, "");
    nextBuffers.lastInterimAtMs = nowMs;
  } else if (finalSegments.length > 0) {
    nextBuffers.interimText = "";
  }

  nextBuffers.updatedAtMs = nowMs;
  return nextBuffers;
}

export function createSpeechTextBufferLogData(
  reason: string,
  buffers: BrowserSpeechTextBuffers | null,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reason,
    turnId: buffers?.turnId ?? null,
    finalChars: buffers?.finalText.length ?? 0,
    interimChars: buffers?.interimText.length ?? 0,
    finalTextPreview: buffers?.finalText
      ? truncateTranscriptForLog(buffers.finalText)
      : "",
    interimTextPreview: buffers?.interimText
      ? truncateTranscriptForLog(buffers.interimText)
      : "",
    updatedAtMs: buffers?.updatedAtMs ?? null,
    lastFinalAtMs: buffers?.lastFinalAtMs ?? null,
    lastInterimAtMs: buffers?.lastInterimAtMs ?? null,
    ...(extra ?? {}),
  };
}

export function clearBrowserSpeechInterimText(
  current: BrowserSpeechTextBuffers | null,
  turnId?: string | null,
  nowMs = Date.now(),
): BrowserSpeechTextBuffers | null {
  if (!current) return current;
  if (turnId && current.turnId !== turnId) return current;
  if (!current.interimText) return current;
  return {
    ...current,
    interimText: "",
    updatedAtMs: nowMs,
  };
}

export function configureBrowserRecognitionLifecycle({
  recognition,
  provider,
  logger,
  toErrorMessage,
  onResult,
  onError,
  isStopRequested,
  setStopRequested,
  getStopReason,
  setStopReason,
  onEnded,
}: ConfigureBrowserRecognitionLifecycleArgs): void {
  let attemptedLocalEnUsFallback = false;
  let pendingLocalEnUsFallback = false;
  let pendingNoSpeechRetry = false;
  let suppressAutoRestartOnEnd = false;

  recognition.onstart = () => {
    suppressAutoRestartOnEnd = false;
    logger.info("BrowserSTT", "Browser dictation started", {
      provider,
      lang: recognition.lang,
    });
  };

  recognition.onresult = (event) => {
    onResult(event);
  };

  recognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
    if (isStopRequested() && event.error === "aborted") {
      logger.info(
        "BrowserSTT",
        "Ignoring aborted event triggered by stop request",
        { provider },
      );
      return;
    }

    if (
      provider === "browser_local" &&
      event.error === "language-not-supported"
    ) {
      const currentLang = recognition.lang || "en-US";
      const alreadyEnUs = currentLang.toLowerCase() === "en-us";
      if (!attemptedLocalEnUsFallback && !alreadyEnUs) {
        attemptedLocalEnUsFallback = true;
        pendingLocalEnUsFallback = true;
        logger.warn(
          "BrowserSTT",
          "Local language unsupported; retrying with en-US fallback",
          {
            provider,
            fromLang: currentLang,
            toLang: "en-US",
          },
        );
        try {
          recognition.stop();
        } catch {
          // noop
        }
        return;
      }
    }

    if (event.error === "no-speech") {
      pendingNoSpeechRetry = true;
      logger.info(
        "BrowserSTT",
        "No speech detected; waiting for onend to restart recognition",
        { provider },
      );
      return;
    }

    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed" ||
      event.error === "audio-capture" ||
      event.error === "network" ||
      event.error === "language-not-supported"
    ) {
      suppressAutoRestartOnEnd = true;
    }

    const message = toErrorMessage(event.error);
    const err = new Error(message);
    onError(err);
    logger.warn("BrowserSTT", "Browser dictation error", {
      provider,
      error: event.error ?? "unknown",
    });
  };

  recognition.onend = () => {
    if (pendingLocalEnUsFallback && !isStopRequested()) {
      pendingLocalEnUsFallback = false;
      recognition.lang = "en-US";
      try {
        recognition.start();
        logger.info(
          "BrowserSTT",
          "Browser local dictation restarted with en-US fallback",
          {
            provider,
            lang: recognition.lang,
          },
        );
        return;
      } catch (err) {
        const fallbackErr =
          err instanceof Error
            ? err
            : new Error("Failed to restart browser dictation with en-US");
        onError(fallbackErr);
        logger.warn("BrowserSTT", "en-US fallback restart failed", {
          provider,
          error: fallbackErr.message,
        });
      }
    }

    if (pendingNoSpeechRetry && !isStopRequested()) {
      pendingNoSpeechRetry = false;
      try {
        recognition.start();
        logger.info("BrowserSTT", "Restarted after no-speech timeout", {
          provider,
          lang: recognition.lang,
        });
        return;
      } catch (err) {
        const restartErr =
          err instanceof Error
            ? err
            : new Error("Failed to restart browser dictation after silence");
        onError(restartErr);
        logger.warn("BrowserSTT", "no-speech restart failed", {
          provider,
          error: restartErr.message,
        });
      }
    }

    const requestedStop = isStopRequested();
    const stopReason = getStopReason();
    if (!requestedStop && !suppressAutoRestartOnEnd) {
      try {
        recognition.start();
        logger.info("BrowserSTT", "Restarted after unexpected end", {
          provider,
          lang: recognition.lang,
        });
        return;
      } catch (err) {
        const restartErr =
          err instanceof Error
            ? err
            : new Error("Failed to restart browser dictation after end");
        onError(restartErr);
        logger.warn("BrowserSTT", "unexpected end restart failed", {
          provider,
          error: restartErr.message,
        });
      }
    }

    onEnded({ requestedStop, stopReason });
    setStopRequested(false);
    setStopReason(null);
  };
}

export function processBrowserRecognitionResult({
  event,
  provider,
  fallbackTurnId,
  logger,
  mode,
  currentTurnId,
  gateState,
  browserSpeechTextBuffers,
  lateFinalTranscriptGraceMs,
  resolveLateFinalWindow,
  pushGateDecision,
  onCommittedSegment,
  syncGateDebugStats,
}: ProcessBrowserRecognitionResultArgs): ProcessBrowserRecognitionResultOutput {
  const { finalSegments, interimSegments } = collectBrowserSpeechSegments(
    event,
    {
      onCollected: (payload) => {
        logger.info("BrowserSTT", "Speech recognition result event snapshot", {
          provider,
          mode,
          turnId: currentTurnId,
          ...payload,
        });
      },
    },
  );

  if (finalSegments.length === 0 && interimSegments.length === 0) {
    return {
      nextGateState: gateState,
      nextBuffers: browserSpeechTextBuffers,
    };
  }

  const runtimeState = useAvatarRuntimeStore.getState();
  if (runtimeState.activeRunId || runtimeState.activeSpeechRunId) {
    const nextBuffers = clearBrowserSpeechInterimText(
      browserSpeechTextBuffers,
      currentTurnId,
    );
    if (nextBuffers !== browserSpeechTextBuffers) {
      logger.info(
        "BrowserSTT",
        "Cleared interim transcript while assistant run is active",
        createSpeechTextBufferLogData("assistant_run_active", nextBuffers, {
          provider,
          mode,
          activeRunId: runtimeState.activeRunId,
          activeSpeechRunId: runtimeState.activeSpeechRunId,
        }),
      );
    }
    logger.info(
      "VADGate",
      "Ignored transcript segments while assistant run is active",
      {
        provider,
        mode,
        activeRunId: runtimeState.activeRunId,
        activeSpeechRunId: runtimeState.activeSpeechRunId,
        finalSegmentCount: finalSegments.length,
        interimSegmentCount: interimSegments.length,
      },
    );
    return {
      nextGateState: gateState,
      nextBuffers,
    };
  }

  let nextBuffers = browserSpeechTextBuffers;
  const hasActiveWindow = Boolean(gateState?.activeWindow);
  const nowMs = Date.now();
  const hasLateWindowGrace =
    typeof currentTurnId === "string" &&
    !hasActiveWindow &&
    Boolean(resolveLateFinalWindow(currentTurnId, nowMs));
  const ignoreUngatedSegments =
    Boolean(currentTurnId) && !hasActiveWindow && !hasLateWindowGrace;

  if (ignoreUngatedSegments) {
    nextBuffers = clearBrowserSpeechInterimText(
      browserSpeechTextBuffers,
      currentTurnId,
      nowMs,
    );
    if (nextBuffers !== browserSpeechTextBuffers) {
      logger.info(
        "BrowserSTT",
        "Cleared interim transcript because no VAD window is active",
        createSpeechTextBufferLogData("no_active_vad_window", nextBuffers, {
          provider,
          mode,
          turnId: currentTurnId,
          finalSegmentsCount: finalSegments.length,
          interimSegmentsCount: interimSegments.length,
        }),
      );
    }
  }

  if (currentTurnId && !ignoreUngatedSegments) {
    nextBuffers = updateBrowserSpeechTextBuffers({
      current: nextBuffers,
      turnId: currentTurnId,
      finalSegments,
      interimSegments,
    });
    logger.info(
      "BrowserSTT",
      "Speech text buffer state",
      createSpeechTextBufferLogData(
        "recognition_onresult_update",
        nextBuffers,
        {
          provider,
          mode,
          finalSegmentsCount: finalSegments.length,
          interimSegmentsCount: interimSegments.length,
        },
      ),
    );
  }

  if (finalSegments.length === 0) {
    return {
      nextGateState: gateState,
      nextBuffers,
    };
  }

  if (!currentTurnId || !gateState) {
    for (const text of finalSegments) {
      const nowMs = Date.now();
      pushGateDecision({
        turnId: fallbackTurnId || "unknown-turn",
        windowId: null,
        createdAtMs: nowMs,
        decision: "ignored",
        reason: "no_active_window",
        text,
        chars: text.length,
        isFinal: true,
      });
      logger.warn(
        "VADGate",
        "Ignored transcript segment because no active turn/window",
        {
          provider,
          turnId: fallbackTurnId,
          textLength: text.length,
        },
      );
    }
    return {
      nextGateState: gateState,
      nextBuffers,
    };
  }

  let currentGateState = gateState;
  for (const text of finalSegments) {
    const routed = routeTranscriptSegment(currentGateState, text);
    let nextGateState = routed.state;
    let nextDecision = routed.decision;
    const nowMs = Date.now();

    if (
      nextDecision.decision === "ignored" &&
      nextDecision.reason === "no_active_window"
    ) {
      const graceWindow = resolveLateFinalWindow(currentTurnId, nowMs);
      const committedText = text.trim();
      if (graceWindow && committedText) {
        const transcriptCommitted = currentGateState.transcriptCommitted
          ? `${currentGateState.transcriptCommitted} ${committedText}`
          : committedText;
        nextGateState = {
          ...currentGateState,
          transcriptCommitted,
        };
        nextDecision = {
          decision: "committed",
          reason: "window_real_speech",
          text: committedText,
          turnId: currentTurnId,
          windowId: graceWindow.windowId,
        };
        logger.info(
          "VADGate",
          "Committed late final transcript after speech window close",
          {
            provider,
            turnId: currentTurnId,
            windowId: graceWindow.windowId,
            textLength: committedText.length,
            closedAtMs: graceWindow.closedAtMs,
            graceMs: lateFinalTranscriptGraceMs,
          },
        );
      }
    }

    currentGateState = nextGateState;
    pushGateDecision({
      turnId: currentTurnId,
      windowId: nextDecision.windowId,
      createdAtMs: nowMs,
      decision: nextDecision.decision,
      reason: nextDecision.reason,
      text: nextDecision.text,
      chars: nextDecision.text.length,
      isFinal: true,
    });

    if (nextDecision.decision === "committed") {
      logger.info("VADGate", "Committed transcript segment", {
        provider,
        turnId: currentTurnId,
        windowId: nextDecision.windowId,
        textLength: nextDecision.text.length,
      });
      onCommittedSegment({
        text: nextDecision.text,
        turnId: currentTurnId,
      });
      continue;
    }

    logger.info("VADGate", "Dropped transcript segment", {
      provider,
      turnId: currentTurnId,
      windowId: nextDecision.windowId,
      decision: nextDecision.decision,
      reason: nextDecision.reason,
      textLength: nextDecision.text.length,
    });
  }

  syncGateDebugStats();

  return {
    nextGateState: currentGateState,
    nextBuffers,
  };
}
