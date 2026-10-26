"use client";

import { useCallback, useEffect, useRef } from "react";

import type { Logger } from "@/lib/logger";
import type { SttProvider } from "@/lib/speech/stt-provider";
import type { AcousticTurnGateState } from "@/lib/voice/acoustic-vad-gate";
import { joinSpeechText } from "@/lib/speech/speech-text";
import { getVoiceDebugSink } from "@/lib/voice/voiceDebugSink";
import type { BrowserSpeechTextBuffers } from "@/hooks/voice/browser-recognition-runtime";

type DictationMode = "dictation" | "voice";
type AvatarVoicePhase =
  | "listening"
  | "user_speaking"
  | "semantic_check"
  | "submitting";

/**
 * What ended the turn: Smart Turn's decision, or, when no decision could be
 * made (the model failed or timed out), the acoustic end of speech.
 */
export type VoiceEndTurnSource = "smart_turn_v3" | "acoustic_fallback";

export type VoiceAutoSubmitPayload = {
  text: string;
  turnId: string;
  jobId: string;
  /** Smart Turn's probability; null for an acoustic fallback. */
  probability: number | null;
  threshold: number;
  latencyMs: number;
  decision: "end_turn";
  source: VoiceEndTurnSource;
};

type VoiceAutoSubmitHandler =
  | ((payload: VoiceAutoSubmitPayload) => void | Promise<void>)
  | undefined;

type PendingVoiceEndTurn = {
  turnId: string;
  jobId: string;
  provider: SttProvider;
  probability: number | null;
  threshold: number;
  latencyMs: number;
  source: VoiceEndTurnSource;
  createdAtMs: number;
  /** The transcript wait ran out while the send was held. */
  timedOut: boolean;
};

type QueuePendingVoiceEndTurnArgs = {
  provider: SttProvider;
  turnId: string;
  jobId: string;
  probability: number | null;
  threshold: number;
  latencyMs: number;
  source?: VoiceEndTurnSource;
};

type SubmitPendingVoiceEndTurnTrigger =
  | "smart_turn_decision"
  | "transcript_update"
  /** A speech window was confirmed as speech or discarded as noise. */
  | "speech_window_update"
  | "timeout";

type UseVoiceEndTurnCoordinatorArgs = {
  logger: Logger;
  waitMs: number;
  getMode: () => DictationMode;
  getActiveProvider: () => SttProvider | null;
  getGateState: () => AcousticTurnGateState | null;
  getSpeechBuffers: () => BrowserSpeechTextBuffers | null;
  onSetAvatarPhase: (phase: AvatarVoicePhase) => void;
  onRotateTurn: (reason: string) => void;
  getOnVoiceAutoSubmit: () => VoiceAutoSubmitHandler;
};

export function useVoiceEndTurnCoordinator({
  logger,
  waitMs,
  getMode,
  getActiveProvider,
  getGateState,
  getSpeechBuffers,
  onSetAvatarPhase,
  onRotateTurn,
  getOnVoiceAutoSubmit,
}: UseVoiceEndTurnCoordinatorArgs) {
  const pendingVoiceEndTurnRef = useRef<PendingVoiceEndTurn | null>(null);
  const pendingVoiceEndTurnTimerRef = useRef<number | null>(null);
  const pendingVoiceAutoSubmitInFlightRef = useRef(false);

  const clearPendingVoiceEndTurnTimer = useCallback(() => {
    if (pendingVoiceEndTurnTimerRef.current !== null) {
      window.clearTimeout(pendingVoiceEndTurnTimerRef.current);
      pendingVoiceEndTurnTimerRef.current = null;
    }
  }, []);

  const clearPendingVoiceEndTurn = useCallback(
    (reason: string) => {
      clearPendingVoiceEndTurnTimer();
      const pending = pendingVoiceEndTurnRef.current;
      pendingVoiceEndTurnRef.current = null;
      pendingVoiceAutoSubmitInFlightRef.current = false;
      if (!pending) return;

      logger.info("SmartTurnSubmit", "Cleared pending end-turn auto-submit", {
        provider: pending.provider,
        turnId: pending.turnId,
        jobId: pending.jobId,
        reason,
      });
    },
    [clearPendingVoiceEndTurnTimer, logger],
  );

  const hasPendingVoiceEndTurn = useCallback(
    () => Boolean(pendingVoiceEndTurnRef.current),
    [],
  );

  const submitPendingVoiceEndTurn = useCallback(
    async (trigger: SubmitPendingVoiceEndTurnTrigger): Promise<boolean> => {
      const pending = pendingVoiceEndTurnRef.current;
      if (!pending) return false;

      if (getMode() !== "voice" || getActiveProvider() !== pending.provider) {
        clearPendingVoiceEndTurn("mode_or_provider_changed");
        onSetAvatarPhase("listening");
        return false;
      }

      if (pendingVoiceAutoSubmitInFlightRef.current) {
        return false;
      }

      if (trigger === "timeout") pending.timedOut = true;
      const gateState = getGateState();
      const isPendingTurnGate = gateState?.turnId === pending.turnId;
      const openWindow = isPendingTurnGate ? gateState.activeWindow : null;
      if (openWindow?.isRealSpeech) {
        // The owner kept talking, so the turn is not over; the next speech
        // end checks the whole turn again.
        clearPendingVoiceEndTurn("speech_resumed");
        return false;
      }
      if (openWindow) {
        // Hold until VAD confirms the new sound as speech or discards it.
        return false;
      }

      const buffers = getSpeechBuffers();
      const isPendingTurnBuffer = buffers?.turnId === pending.turnId;
      // Web Speech words not yet final; their final result usually follows the
      // end of speech, so the send waits for it until the wait runs out.
      const unfinalizedText = isPendingTurnBuffer
        ? buffers.interimText.trim()
        : "";
      if (unfinalizedText && !pending.timedOut) {
        return false;
      }

      let transcriptToSubmit = isPendingTurnGate
        ? gateState.transcriptCommitted.trim()
        : "";
      let transcriptSource:
        | "committed"
        | "committed_with_interim"
        | "final_timeout_fallback"
        | "interim_timeout_fallback" = "committed";

      if (!transcriptToSubmit && pending.timedOut && isPendingTurnBuffer) {
        const bufferedFinal = buffers.finalText.trim();
        if (bufferedFinal) {
          transcriptToSubmit = bufferedFinal;
          transcriptSource = "final_timeout_fallback";
        }
      }
      if (unfinalizedText) {
        transcriptSource = transcriptToSubmit
          ? "committed_with_interim"
          : "interim_timeout_fallback";
        transcriptToSubmit = joinSpeechText(
          transcriptToSubmit,
          unfinalizedText,
        );
      }

      if (!transcriptToSubmit) {
        if (pending.timedOut) {
          const debugStore = getVoiceDebugSink();
          debugStore?.pushSmartTurnEvent({
            type: "auto_submit_skipped",
            turnId: pending.turnId,
            jobId: pending.jobId,
            provider: pending.provider,
            createdAtMs: Date.now(),
            details:
              "Timed out waiting for committed transcript after end_turn decision.",
          });
          logger.info(
            "SmartTurnSubmit",
            "Skipped auto-submit after timeout waiting for transcript",
            {
              provider: pending.provider,
              turnId: pending.turnId,
              jobId: pending.jobId,
              waitMs,
              hasBufferedFinal:
                isPendingTurnBuffer && Boolean(buffers.finalText),
            },
          );
          clearPendingVoiceEndTurn("timeout_no_transcript");
          onSetAvatarPhase("listening");
        }
        return false;
      }

      const callback = getOnVoiceAutoSubmit();
      if (!callback) {
        const debugStore = getVoiceDebugSink();
        debugStore?.pushSmartTurnEvent({
          type: "auto_submit_skipped",
          turnId: pending.turnId,
          jobId: pending.jobId,
          provider: pending.provider,
          createdAtMs: Date.now(),
          details: "No onVoiceAutoSubmit callback registered.",
        });
        logger.info(
          "SmartTurnSubmit",
          "Skipped auto-submit because callback is missing",
          {
            provider: pending.provider,
            turnId: pending.turnId,
            jobId: pending.jobId,
          },
        );
        clearPendingVoiceEndTurn("missing_callback");
        onSetAvatarPhase("listening");
        return false;
      }

      pendingVoiceAutoSubmitInFlightRef.current = true;
      clearPendingVoiceEndTurnTimer();
      const elapsedMs = Math.max(0, Date.now() - pending.createdAtMs);
      const debugStore = getVoiceDebugSink();
      onSetAvatarPhase("submitting");
      debugStore?.pushSmartTurnEvent({
        type: "auto_submit",
        turnId: pending.turnId,
        jobId: pending.jobId,
        provider: pending.provider,
        createdAtMs: Date.now(),
        details: `chars=${transcriptToSubmit.length} trigger=${trigger} wait_ms=${elapsedMs} source=${transcriptSource}`,
      });
      logger.info("SmartTurnSubmit", "Auto-submit triggered", {
        provider: pending.provider,
        turnId: pending.turnId,
        jobId: pending.jobId,
        transcriptLength: transcriptToSubmit.length,
        transcriptSource,
        probability: pending.probability,
        latencyMs: pending.latencyMs,
        trigger,
        waitMs: elapsedMs,
      });

      try {
        await callback({
          text: transcriptToSubmit,
          turnId: pending.turnId,
          jobId: pending.jobId,
          probability: pending.probability,
          threshold: pending.threshold,
          latencyMs: pending.latencyMs,
          decision: "end_turn",
          source: pending.source,
        });
        clearPendingVoiceEndTurn("submitted");
        onRotateTurn("semantic_end_turn");
        onSetAvatarPhase("listening");
        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        debugStore?.pushSmartTurnEvent({
          type: "auto_submit_skipped",
          turnId: pending.turnId,
          jobId: pending.jobId,
          provider: pending.provider,
          createdAtMs: Date.now(),
          details: `Auto-submit callback failed: ${errorMessage}`,
        });
        logger.error(
          "SmartTurnSubmit",
          "Auto-submit callback failed after end-turn decision",
          err,
        );
        clearPendingVoiceEndTurn("submit_callback_error");
        onSetAvatarPhase("listening");
        return false;
      }
    },
    [
      clearPendingVoiceEndTurn,
      clearPendingVoiceEndTurnTimer,
      getActiveProvider,
      getGateState,
      getMode,
      getOnVoiceAutoSubmit,
      getSpeechBuffers,
      logger,
      onRotateTurn,
      onSetAvatarPhase,
      waitMs,
    ],
  );

  const queuePendingVoiceEndTurn = useCallback(
    async (args: QueuePendingVoiceEndTurnArgs): Promise<void> => {
      clearPendingVoiceEndTurn("superseded_by_new_end_turn");
      pendingVoiceEndTurnRef.current = {
        turnId: args.turnId,
        jobId: args.jobId,
        provider: args.provider,
        probability: args.probability,
        threshold: args.threshold,
        latencyMs: args.latencyMs,
        source: args.source ?? "smart_turn_v3",
        createdAtMs: Date.now(),
        timedOut: false,
      };

      clearPendingVoiceEndTurnTimer();
      pendingVoiceEndTurnTimerRef.current = window.setTimeout(() => {
        void submitPendingVoiceEndTurn("timeout");
      }, waitMs);

      logger.info(
        "SmartTurnSubmit",
        "Queued end-turn auto-submit while waiting for transcript",
        {
          provider: args.provider,
          turnId: args.turnId,
          jobId: args.jobId,
          maxWaitMs: waitMs,
        },
      );

      const submittedImmediately = await submitPendingVoiceEndTurn(
        "smart_turn_decision",
      );
      if (!submittedImmediately) {
        onSetAvatarPhase("listening");
      }
    },
    [
      clearPendingVoiceEndTurn,
      clearPendingVoiceEndTurnTimer,
      logger,
      onSetAvatarPhase,
      submitPendingVoiceEndTurn,
      waitMs,
    ],
  );

  useEffect(
    () => () => {
      clearPendingVoiceEndTurn("hook_unmount");
    },
    [clearPendingVoiceEndTurn],
  );

  return {
    clearPendingVoiceEndTurn,
    hasPendingVoiceEndTurn,
    queuePendingVoiceEndTurn,
    submitPendingVoiceEndTurn,
  };
}
