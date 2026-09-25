"use client";

import type { MutableRefObject } from "react";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import type { Logger } from "@/lib/logger";
import type { AcousticTurnGateState } from "@/lib/voice/acoustic-vad-gate";
import {
  discardSpeechWindowMisfire,
  finishSpeechWindow,
  markSpeechWindowRealStart,
  openSpeechWindow,
} from "@/lib/voice/acoustic-vad-gate";

type BrowserSttProvider = "browser_external" | "browser_local";
type VadSttProvider = BrowserSttProvider | "parakeet";
type DictationMode = "dictation" | "voice";

type ClosedRealSpeechWindow = {
  turnId: string;
  windowId: string;
  closedAtMs: number;
  expiresAtMs: number;
};

type VoiceVadDebugStoreLike = {
  setActiveWindow: (windowId: string) => void;
  setWindowRealSpeech: (isRealSpeech: boolean) => void;
  clearActiveWindow: () => void;
  appendAudioSamples: (sampleCount: number) => void;
  setSmartTurnBufferedAudio: (audio: {
    sampleRateHz: number;
    samples: Float32Array;
  }) => void;
  setLatestFrame: (frame: {
    createdAtMs: number;
    isSpeech: number;
    notSpeech: number;
  }) => void;
  pushEvent: (event: {
    turnId: string;
    windowId: string | null;
    provider: string | null;
    type: "speech_start" | "speech_real_start" | "misfire" | "speech_end";
    createdAtMs: number;
    audioSamples: number | null;
  }) => void;
};

export type CreateMicVadCallbacksArgs = {
  provider: VadSttProvider;
  logger: Logger;
  debugStore: VoiceVadDebugStoreLike | null;
  modeRef: MutableRefObject<DictationMode>;
  gateStateRef: MutableRefObject<AcousticTurnGateState | null>;
  turnIdRef: MutableRefObject<string | null>;
  lastAcceptedSpeechAtRef: MutableRefObject<number | null>;
  lastClosedRealSpeechWindowRef: MutableRefObject<ClosedRealSpeechWindow | null>;
  smartTurnAudioRef: MutableRefObject<Float32Array>;
  smartTurnWorkerReadyRef: MutableRefObject<boolean>;
  vadFrameLastPublishedAtRef: MutableRefObject<number>;
  clearVoiceSilenceResetTimer: () => void;
  syncGateDebugStats: () => void;
  setAvatarPhaseFromVad: (phase: "listening" | "user_speaking") => void;
  armVoiceSilenceResetTimer: (reason: "vad_misfire" | "speech_end") => void;
  onSpeechWindowInvalidated?: (args: {
    reason: "vad_misfire" | "speech_end_rejected";
    turnId: string;
    windowId: string | null;
    provider: VadSttProvider;
  }) => void;
  onSpeechWindowStarted?: (args: {
    turnId: string;
    windowId: string;
    provider: VadSttProvider;
    startedAtMs: number;
  }) => void;
  onAcceptedSpeechEnd?: (args: {
    audio: Float32Array;
    turnId: string;
    windowId: string;
    provider: VadSttProvider;
    audioSamples: number;
    closedAtMs: number;
  }) => void;
  runSmartTurnSemanticCheck: (args: {
    provider: VadSttProvider;
    turnId: string;
  }) => Promise<void>;
  lateFinalTranscriptGraceMs: number;
  smartTurnSampleRate: number;
  vadFrameDebugIntervalMs: number;
};

export type CreateAndStartMicVadArgs = {
  baseAssetPath: string;
  onnxWasmBasePath: string;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionMs: number;
  preSpeechPadMs: number;
  minSpeechMs: number;
  /** Opens the capture stream; omitted, vad-web opens the system default mic. */
  getStream?: () => Promise<MediaStream>;
  onSpeechStart: () => void;
  onSpeechRealStart: () => void;
  onVADMisfire: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onFrameProcessed: (probabilities: {
    isSpeech: number;
    notSpeech: number;
  }) => void;
};

export type MicVadCallbacks = Pick<
  CreateAndStartMicVadArgs,
  | "onSpeechStart"
  | "onSpeechRealStart"
  | "onVADMisfire"
  | "onSpeechEnd"
  | "onFrameProcessed"
>;

export type MicVadInstance = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
  setOptions: (update: { submitUserSpeechOnPause?: boolean }) => void;
};

const ortWasmPaths = {
  // ORT dynamically imports this module, so Vite must resolve it as a bundled URL.
  // Public /onnx/ort/*.mjs files fail in dev when ORT appends ?import.
  mjs: ortWasmMjsUrl,
  wasm: ortWasmUrl,
};

export function createMicVadCallbacks({
  provider,
  logger,
  debugStore,
  modeRef,
  gateStateRef,
  turnIdRef,
  lastAcceptedSpeechAtRef,
  lastClosedRealSpeechWindowRef,
  smartTurnAudioRef,
  smartTurnWorkerReadyRef,
  vadFrameLastPublishedAtRef,
  clearVoiceSilenceResetTimer,
  syncGateDebugStats,
  setAvatarPhaseFromVad,
  armVoiceSilenceResetTimer,
  onSpeechWindowInvalidated,
  onSpeechWindowStarted,
  onAcceptedSpeechEnd,
  runSmartTurnSemanticCheck,
  lateFinalTranscriptGraceMs,
  smartTurnSampleRate,
  vadFrameDebugIntervalMs,
}: CreateMicVadCallbacksArgs): MicVadCallbacks {
  return {
    onSpeechStart: () => {
      clearVoiceSilenceResetTimer();
      const gateState = gateStateRef.current;
      const currentTurnId = turnIdRef.current;
      if (!gateState || !currentTurnId) return;
      const nowMs = Date.now();
      const opened = openSpeechWindow(gateState, nowMs);
      gateStateRef.current = opened.state;
      syncGateDebugStats();
      debugStore?.setActiveWindow(opened.windowId);
      debugStore?.pushEvent({
        turnId: currentTurnId,
        type: "speech_start",
        createdAtMs: nowMs,
        windowId: opened.windowId,
        provider,
        audioSamples: null,
      });
      logger.info("VADEvent", "Speech start", {
        provider,
        turnId: currentTurnId,
        windowId: opened.windowId,
      });
      onSpeechWindowStarted?.({
        turnId: currentTurnId,
        windowId: opened.windowId,
        provider,
        startedAtMs: nowMs,
      });
      setAvatarPhaseFromVad("listening");
    },
    onSpeechRealStart: () => {
      clearVoiceSilenceResetTimer();
      const gateState = gateStateRef.current;
      const currentTurnId = turnIdRef.current;
      const windowId = gateState?.activeWindow?.windowId ?? null;
      if (!gateState || !currentTurnId || !windowId) return;
      gateStateRef.current = markSpeechWindowRealStart(gateState);
      syncGateDebugStats();
      debugStore?.setWindowRealSpeech(true);
      debugStore?.pushEvent({
        turnId: currentTurnId,
        type: "speech_real_start",
        createdAtMs: Date.now(),
        windowId,
        provider,
        audioSamples: null,
      });
      logger.info("VADEvent", "Real speech start", {
        provider,
        turnId: currentTurnId,
        windowId,
      });
      setAvatarPhaseFromVad("user_speaking");
    },
    onVADMisfire: () => {
      const gateState = gateStateRef.current;
      const currentTurnId = turnIdRef.current;
      const windowId = gateState?.activeWindow?.windowId ?? null;
      if (!gateState || !currentTurnId) return;
      gateStateRef.current = discardSpeechWindowMisfire(gateState);
      syncGateDebugStats();
      debugStore?.clearActiveWindow();
      debugStore?.pushEvent({
        turnId: currentTurnId,
        type: "misfire",
        createdAtMs: Date.now(),
        windowId,
        provider,
        audioSamples: null,
      });
      logger.info("VADEvent", "VAD misfire", {
        provider,
        turnId: currentTurnId,
        windowId,
      });
      onSpeechWindowInvalidated?.({
        reason: "vad_misfire",
        turnId: currentTurnId,
        windowId,
        provider,
      });
      if (modeRef.current === "voice") {
        armVoiceSilenceResetTimer("vad_misfire");
      }
      setAvatarPhaseFromVad("listening");
    },
    onSpeechEnd: (audio) => {
      const gateState = gateStateRef.current;
      const currentTurnId = turnIdRef.current;
      if (!gateState || !currentTurnId) return;
      const result = finishSpeechWindow(gateState, audio.length);
      gateStateRef.current = result.state;
      const nowMs = Date.now();
      if (result.accepted && result.windowId) {
        lastAcceptedSpeechAtRef.current = nowMs;
        lastClosedRealSpeechWindowRef.current = {
          turnId: currentTurnId,
          windowId: result.windowId,
          closedAtMs: nowMs,
          expiresAtMs: nowMs + lateFinalTranscriptGraceMs,
        };
      }
      syncGateDebugStats();
      debugStore?.clearActiveWindow();
      if (result.accepted && result.audioSamples > 0) {
        debugStore?.appendAudioSamples(result.audioSamples);
      }
      debugStore?.pushEvent({
        turnId: currentTurnId,
        type: "speech_end",
        createdAtMs: nowMs,
        windowId: result.windowId,
        provider,
        audioSamples: result.accepted ? result.audioSamples : null,
      });
      logger.info("VADEvent", "Speech end", {
        provider,
        turnId: currentTurnId,
        windowId: result.windowId,
        accepted: result.accepted,
        reason: result.reason,
        audioSamples: result.audioSamples,
      });
      if (!result.accepted) {
        onSpeechWindowInvalidated?.({
          reason: "speech_end_rejected",
          turnId: currentTurnId,
          windowId: result.windowId,
          provider,
        });
      }
      if (result.accepted && result.windowId && audio.length > 0) {
        onAcceptedSpeechEnd?.({
          audio,
          turnId: currentTurnId,
          windowId: result.windowId,
          provider,
          audioSamples: result.audioSamples,
          closedAtMs: nowMs,
        });
      }

      let shouldReturnToListening = true;
      if (
        modeRef.current === "voice" &&
        provider !== "parakeet" &&
        result.accepted &&
        audio.length > 0
      ) {
        const nextAudio = new Float32Array(
          smartTurnAudioRef.current.length + audio.length,
        );
        nextAudio.set(smartTurnAudioRef.current);
        nextAudio.set(audio, smartTurnAudioRef.current.length);
        smartTurnAudioRef.current = nextAudio;
        debugStore?.setSmartTurnBufferedAudio({
          sampleRateHz: smartTurnSampleRate,
          samples: nextAudio,
        });
        logger.info(
          "SmartTurnAudio",
          "Appended voiced audio segment for smart-turn",
          {
            provider,
            turnId: currentTurnId,
            segmentSamples: audio.length,
            bufferedSamples: nextAudio.length,
          },
        );
        if (smartTurnWorkerReadyRef.current) {
          shouldReturnToListening = false;
          void runSmartTurnSemanticCheck({
            provider,
            turnId: currentTurnId,
          });
        } else {
          logger.warn(
            "SmartTurnJob",
            "Skipped smart-turn job because worker is not ready",
            {
              provider,
              turnId: currentTurnId,
            },
          );
        }
      }

      if (shouldReturnToListening) {
        setAvatarPhaseFromVad("listening");
      }
      if (modeRef.current === "voice") {
        armVoiceSilenceResetTimer("speech_end");
      }
    },
    onFrameProcessed: (probabilities) => {
      const nowMs = Date.now();
      if (
        nowMs - vadFrameLastPublishedAtRef.current <
        vadFrameDebugIntervalMs
      ) {
        return;
      }
      vadFrameLastPublishedAtRef.current = nowMs;
      debugStore?.setLatestFrame({
        createdAtMs: nowMs,
        isSpeech: probabilities.isSpeech,
        notSpeech: probabilities.notSpeech,
      });
    },
  };
}

export async function createAndStartMicVad({
  baseAssetPath,
  onnxWasmBasePath,
  positiveSpeechThreshold,
  negativeSpeechThreshold,
  redemptionMs,
  preSpeechPadMs,
  minSpeechMs,
  getStream,
  onSpeechStart,
  onSpeechRealStart,
  onVADMisfire,
  onSpeechEnd,
  onFrameProcessed,
}: CreateAndStartMicVadArgs): Promise<MicVadInstance> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const vad = await MicVAD.new({
    model: "v5",
    processorType: "AudioWorklet",
    startOnLoad: false,
    baseAssetPath,
    onnxWASMBasePath: onnxWasmBasePath,
    positiveSpeechThreshold,
    negativeSpeechThreshold,
    redemptionMs,
    preSpeechPadMs,
    minSpeechMs,
    ...(getStream ? { getStream } : {}),
    onSpeechStart,
    onSpeechRealStart,
    onVADMisfire,
    onSpeechEnd,
    onFrameProcessed,
    ortConfig: (ort) => {
      ort.env.wasm.wasmPaths = ortWasmPaths;
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "error";
    },
  });
  await vad.start();
  return vad;
}
