"use client";

import { useCallback, useEffect, useRef } from "react";

import type { Logger } from "@/lib/logger";
import type { SttProvider } from "@/lib/speech/stt-provider";
import type { AcousticTurnGateState } from "@/lib/voice/acoustic-vad-gate";
import { getVoiceDebugSink } from "@/lib/voice/voiceDebugSink";
import type { BrowserSpeechTextBuffers } from "@/hooks/voice/browser-recognition-runtime";

type DictationMode = "dictation" | "voice";
type AvatarVoicePhase =
  | "listening"
  | "user_speaking"
  | "semantic_check"
  | "submitting";

type VoiceAutoSubmitPayload = {
  text: string;
  turnId: string;
  jobId: string;
  probability: number;
  threshold: number;
  latencyMs: number;
  decision: "end_turn";
  source: "smart_turn_v3";
};

type VoiceAutoSubmitHandler =
  | ((payload: VoiceAutoSubmitPayload) => void | Promise<void>)
  | undefined;

type PendingVoiceEndTurn = {
  turnId: string;
  jobId: string;
  provider: SttProvider;
  probability: number;
  threshold: number;
  latencyMs: number;
  createdAtMs: number;
};

type QueuePendingVoiceEndTurnArgs = {
  provider: SttProvider;
  turnId: string;
  jobId: string;
  probability: number;
  threshold: number;
  latencyMs: number;
};

type SubmitPendingVoiceEndTurnTrigger =
  | "smart_turn_decision"
  | "transcript_update"
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

      const gateState = getGateState();
      let transcriptToSubmit =
        gateState && gateState.turnId === pending.turnId
          ? gateState.transcriptCommitted.trim()
          : "";
      let transcriptSource:
        | "committed"
        | "final_timeout_fallback"
        | "interim_timeout_fallback" = "committed";

      if (!transcriptToSubmit && trigger === "timeout") {
        const buffers = getSpeechBuffers();
        if (buffers && buffers.turnId === pending.turnId) {
          const bufferedFinal = buffers.finalText.trim();
          const bufferedInterim = buffers.interimText.trim();
          if (bufferedFinal) {
            transcriptToSubmit = bufferedFinal;
            transcriptSource = "final_timeout_fallback";
          } else if (bufferedInterim) {
            transcriptToSubmit = bufferedInterim;
            transcriptSource = "interim_timeout_fallback";
          }
        }
      }

      if (!transcriptToSubmit) {
        if (trigger === "timeout") {
          const buffers = getSpeechBuffers();
          const isPendingTurnBuffer =
            Boolean(buffers) && buffers?.turnId === pending.turnId;
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
                isPendingTurnBuffer && Boolean(buffers?.finalText),
              hasBufferedInterim:
                isPendingTurnBuffer && Boolean(buffers?.interimText),
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
          source: "smart_turn_v3",
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
        createdAtMs: Date.now(),
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
