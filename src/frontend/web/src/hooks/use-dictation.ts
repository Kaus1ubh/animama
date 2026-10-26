"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getI18n } from "react-i18next";

import { createLogger } from "@/lib/logger";
import { publicResourceUrl } from "@/lib/resource-urls";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";
import {
  getSpeechRecognitionConstructor,
  resolveRoutedSttProvider,
  supportsLocalWebSpeechStrict,
  toSttProvider,
  type BrowserSpeechRecognition,
  type SttProvider,
} from "@/lib/speech/stt-provider";
import { offlineSttClients } from "@/lib/speech/offline-stt/clients";
import {
  routeOfflineSpeech,
  type OfflineSpeechRoute,
} from "@/lib/speech/offline-stt/routing";
import {
  DEFAULT_SPEECH_PREVIEW_CONFIG,
  createSpeechPreviewController,
  shouldEnableSpeechPreviews,
  type SpeechPreview,
  type SpeechPreviewController,
} from "@/lib/speech/offline-stt/preview-controller";
import type { OfflineSttBackend } from "@/lib/speech/offline-stt/worker-protocol";
import { browserSpeechLanguage } from "@/lib/speech/speech-language";
import {
  type BrowserRecognitionStopReason,
  appendTranscript,
  clearBrowserSpeechInterimText,
  configureBrowserRecognitionLifecycle,
  createBrowserSpeechTextBuffers,
  processBrowserRecognitionResult,
  type BrowserSpeechTextBuffers,
  updateBrowserSpeechTextBuffers,
} from "@/hooks/voice/browser-recognition-runtime";
import {
  useVoiceEndTurnCoordinator,
  type VoiceAutoSubmitPayload,
} from "@/hooks/voice/use-voice-end-turn-coordinator";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  microphoneAudioConstraints,
  openSelectedMicrophone,
  readSelectedMicrophoneId,
  vadThresholdsForSensitivity,
  type VadThresholds,
} from "@/lib/voice/microphone-preferences";
import { useSettings } from "@/ui/settings/SettingsProvider";
import {
  isParakeetWebgpuPreferred,
  offlineSttEnginePreference,
} from "@/lib/settings/preferences";
import {
  startAcousticTurn,
  type AcousticTurnGateState,
} from "@/lib/voice/acoustic-vad-gate";
import {
  disposeSmartTurnWorker,
  loadSmartTurnWorker,
  predictSmartTurn,
} from "@/lib/voice/smart-turn-worker-client";
import {
  SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET,
  normalizeSmartTurnOverrideText,
} from "@/lib/voice/smart-turn-short-utterance-overrides";
import { createInFlightWork } from "@/lib/voice/in-flight-work";
import { getVoiceDebugSink } from "@/lib/voice/voiceDebugSink";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import type { SttSegmentSource } from "@/lib/types/voice-types";
import type { MicVadInstance } from "@/hooks/voice/mic-vad-runtime";
import { WordedError } from "@/lib/errors/apiError";

type DictationSegment = {
  text: string;
  isFinal?: boolean;
  runId?: string | null;
  turnId?: string | null;
  source?: SttSegmentSource;
};

type DictationMode = "dictation" | "voice";

type VoiceSilenceResetPayload = {
  turnId: string;
  silenceMs: number;
  hadCommittedText: boolean;
  hadTentativeText: boolean;
  hadSmartTurnAudio: boolean;
  reason: "silence_timeout_6s";
};

type DictationTranscriptPreview = {
  turnId: string | null;
  finalText: string;
  interimText: string;
  provider: SttProvider | null;
  mode: DictationMode;
};

type UseDictationOptions = {
  onSegment?: (segment: DictationSegment) => void;
  onTranscriptPreview?: (preview: DictationTranscriptPreview) => void;
  onError?: (error: Error) => void;
  onVoiceAutoSubmit?: (payload: VoiceAutoSubmitPayload) => void | Promise<void>;
  onVoiceSilenceReset?: (payload: VoiceSilenceResetPayload) => void;
};

type MuteVoiceMicOptions = {
  flushPendingSpeech?: boolean;
};

type StopDictationOptions = {
  /**
   * Whether stopping dictation first delivers the phrase being spoken
   * (default). A mode switch or unmount passes false: the composer already
   * holds the visible words, so delivering them again would duplicate them.
   */
  finishSpokenText?: boolean;
};

type SuspendVadCaptureOptions = {
  flushPendingSpeech?: boolean;
};

type SmartTurnThresholdOverrideReason = "ptt_release";

type SmartTurnThresholdOverride = {
  threshold: number;
  reason: SmartTurnThresholdOverrideReason;
};

type PendingFlushSmartTurnOverride = SmartTurnThresholdOverride & {
  provider: SttProvider;
  turnId: string;
};

type BrowserSttProvider = Exclude<SttProvider, "parakeet">;
type VoiceSttProvider = SttProvider;
type ClosedRealSpeechWindow = {
  turnId: string;
  windowId: string;
  closedAtMs: number;
  expiresAtMs: number;
};

const DEFAULT_SAMPLE_RATE = 16000;
const RUN_ID_GRACE_MS = 2000;
const VAD_BASE_ASSET_PATH = publicResourceUrl("onnx/models/vad/");
const VAD_ONNX_WASM_BASE_PATH = publicResourceUrl("onnx/ort/1.24.2/");
const VAD_FRAME_DEBUG_INTERVAL_MS = 120;
const LATE_FINAL_TRANSCRIPT_GRACE_MS = 1000;
const SMART_TURN_END_TURN_WAIT_MS = 1000;
// How long a stop waits for the recognizer to end, and in dictation for the
// final result of the phrase just spoken.
const BROWSER_RECOGNITION_END_WAIT_MS = 1500;
// How long stopping offline dictation waits for windows still being transcribed.
const OFFLINE_STOP_TRANSCRIPTION_WAIT_MS = 5000;
const VOICE_SILENCE_RESET_MS = 6000;
const VOICE_SILENCE_RESET_DEFER_MS = 250;
const SMART_TURN_MODEL_URL = publicResourceUrl(
  "onnx/models/smart-turn/smart-turn-v3.2-cpu.onnx",
);
const SMART_TURN_THRESHOLD = 0.2;
const PTT_RELEASE_SMART_TURN_THRESHOLD = 0.05;
const SMART_TURN_SAMPLE_RATE = 16000;
const SMART_TURN_MODEL_WINDOW_SAMPLES = SMART_TURN_SAMPLE_RATE * 8;
const SMART_TURN_SHORT_UTTERANCE_MAX_MS = 2000;

// Positive/negative speech thresholds and minimum speech length come from the
// microphone sensitivity preference (see lib/voice/microphone-preferences.ts).
const MICVAD_REDEMPTION_MS = 1400; // number of milliseconds of speech-negative frames to wait before ending a speech segment. default: 1400, 200 recommended when paired with smart-turn
const MICVAD_PRESPEECH_PAD_MS = 200; // number of milliseconds of audio to prepend to a speech segment. default: 800

// We stream raw PCM16 over WS to keep latency low and avoid codec overhead.
// The mic provides Float32 frames, so we must convert to PCM16 continuously.
// AudioWorklet runs on the audio rendering thread (not the UI thread), which
// keeps timing stable and reduces dropouts when the main thread is busy.
// ScriptProcessor is deprecated but used as a fallback where AudioWorklet is
// unavailable.
function createRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `turn-${crypto.randomUUID()}`;
  }
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `job-${crypto.randomUUID()}`;
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toAbsoluteBrowserUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

/** Dictation failures reported to the owner (and the dictation error toast). */
type DictationFailure =
  | "audioWorkletOffline"
  | "audioWorkletVad"
  | "browserStartFailed"
  | "failed"
  | "localWebSpeechNotEnabled"
  | "localWebSpeechUnsupported"
  | "offlineSpeechMissing"
  | "languageSpeechMissing"
  | "offlineSpeechFailed"
  | "transcriptionFailed"
  | "unmuteFailed"
  | "webSpeechUnsupported";

/** Word a dictation failure in the active UI Locale. */
function dictationErrorText(failure: DictationFailure): string {
  const t = getI18n().getFixedT(null, "app");
  switch (failure) {
    case "audioWorkletOffline":
      return t("dictation.errors.audioWorkletOffline");
    case "audioWorkletVad":
      return t("dictation.errors.audioWorkletVad");
    case "browserStartFailed":
      return t("dictation.errors.browserStartFailed");
    case "failed":
      return t("dictation.errors.failed");
    case "localWebSpeechNotEnabled":
      return t("dictation.errors.localWebSpeechNotEnabled");
    case "localWebSpeechUnsupported":
      return t("dictation.errors.localWebSpeechUnsupported");
    case "offlineSpeechMissing":
      return t("dictation.errors.offlineSpeechMissing");
    case "languageSpeechMissing":
      return t("dictation.errors.languageSpeechMissing");
    case "offlineSpeechFailed":
      return t("dictation.errors.offlineSpeechFailed");
    case "transcriptionFailed":
      return t("dictation.errors.transcriptionFailed");
    case "unmuteFailed":
      return t("dictation.errors.unmuteFailed");
    case "webSpeechUnsupported":
      return t("dictation.errors.webSpeechUnsupported");
  }
}

/** Word a Web Speech error code in the active UI Locale. */
function toBrowserSttErrorMessage(errorCode: string | undefined): string {
  const t = getI18n().getFixedT(null, "app");
  switch (errorCode) {
    case "not-allowed":
      return t("dictation.errors.browser.notAllowed");
    case "audio-capture":
      return t("dictation.errors.browser.audioCapture");
    case "service-not-allowed":
      return t("dictation.errors.browser.serviceNotAllowed");
    case "network":
      return t("dictation.errors.browser.network");
    case "no-speech":
      return t("dictation.errors.browser.noSpeech");
    case "language-not-supported":
      return t("dictation.errors.browser.languageNotSupported");
    case "aborted":
      return t("dictation.errors.browser.aborted");
    default:
      return t("dictation.errors.browser.failed");
  }
}

function buildSmartTurnModelAudioWindow(
  audio: Float32Array,
  targetSamples = SMART_TURN_MODEL_WINDOW_SAMPLES,
): Float32Array {
  if (audio.length === targetSamples) {
    return new Float32Array(audio);
  }
  if (audio.length > targetSamples) {
    return audio.slice(audio.length - targetSamples);
  }
  const padded = new Float32Array(targetSamples);
  padded.set(audio, targetSamples - audio.length);
  return padded;
}

export function useDictation(options: UseDictationOptions = {}) {
  const apiClient = useProductApiClient();

  const logger = useMemo(() => createLogger("Dictation"), []);
  const [isDictating, setIsDictating] = useState(false);
  const [activeMode, setActiveMode] = useState<DictationMode | null>(null);
  const [isMicCaptureActive, setIsMicCaptureActive] = useState(false);
  const [isDictationPreparing, setIsDictationPreparing] = useState(false);
  const [isVoiceMicMuted, setIsVoiceMicMuted] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const { effectivePreferences } = useSettings();
  // Read at each offline start so a settings change applies to the next session.
  const offlineWebgpuPreferredRef = useRef(false);
  offlineWebgpuPreferredRef.current =
    isParakeetWebgpuPreferred(effectivePreferences);
  /** The offline engine the owner chose; null follows the conversation language. */
  const savedOfflineSttEngine =
    offlineSttEnginePreference(effectivePreferences);
  const platform = useRuntimePlatform();
  // Read at VAD start so a sensitivity change applies to the next session.
  const micVadThresholdsRef = useRef<VadThresholds>(
    vadThresholdsForSensitivity(undefined),
  );
  const micSensitivity = effectivePreferences?.speech?.mic_sensitivity;
  useEffect(() => {
    micVadThresholdsRef.current = vadThresholdsForSensitivity(micSensitivity);
  }, [micSensitivity]);

  const runIdRef = useRef<string | null>(null);
  const runIdTimerRef = useRef<number | null>(null);
  const isDictatingRef = useRef(false);
  const onSegmentRef = useRef(options.onSegment);
  const onTranscriptPreviewRef = useRef(options.onTranscriptPreview);
  const onErrorRef = useRef(options.onError);
  const onVoiceAutoSubmitRef = useRef(options.onVoiceAutoSubmit);
  const onVoiceSilenceResetRef = useRef(options.onVoiceSilenceReset);
  const activeProviderRef = useRef<SttProvider | null>(null);
  const activeModeRef = useRef<DictationMode | null>(null);
  const modeRef = useRef<DictationMode>("dictation");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const browserVisualizerStreamRef = useRef<MediaStream | null>(null);
  const speechStopRequestedRef = useRef(false);
  const browserRecognitionStopReasonRef =
    useRef<BrowserRecognitionStopReason>(null);
  const vadRef = useRef<MicVadInstance | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const gateStateRef = useRef<AcousticTurnGateState | null>(null);
  const browserSpeechTextBuffersRef = useRef<BrowserSpeechTextBuffers | null>(
    null,
  );
  const rotateVoiceTurnRef = useRef<(reason: string) => void>(() => {});
  const lastClosedRealSpeechWindowRef = useRef<ClosedRealSpeechWindow | null>(
    null,
  );
  const voiceSilenceResetTimerRef = useRef<number | null>(null);
  const lastAcceptedSpeechAtRef = useRef<number | null>(null);
  const vadFrameLastPublishedAtRef = useRef(0);
  const smartTurnAudioRef = useRef<Float32Array>(new Float32Array(0));
  const smartTurnActiveJobRef = useRef<{
    jobId: string;
    sequence: number;
  } | null>(null);
  const smartTurnJobCounterRef = useRef(0);
  const smartTurnWorkerReadyRef = useRef(false);
  const offlineSessionCounterRef = useRef(0);
  const activeOfflineSessionIdRef = useRef<number | null>(null);
  const offlineJobCounterRef = useRef(0);
  const offlineTranscriptionsRef = useRef(createInFlightWork());
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const offlinePreviewControllerRef = useRef<SpeechPreviewController | null>(
    null,
  );
  /** Display-only interim text; never written to gate state or speech buffers. */
  const offlinePreviewRef = useRef<SpeechPreview | null>(null);
  /**
   * The engine and language of the current or last offline session. The
   * provider stays `"parakeet"` (the stored offline choice) for either engine;
   * a resumed Voice Mode session keeps its route.
   */
  const offlineRouteRef = useRef<OfflineSpeechRoute | null>(null);
  const pendingFlushSmartTurnOverrideRef =
    useRef<PendingFlushSmartTurnOverride | null>(null);

  useEffect(() => {
    isDictatingRef.current = isDictating;
  }, [isDictating]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    onSegmentRef.current = options.onSegment;
  }, [options.onSegment]);

  useEffect(() => {
    onTranscriptPreviewRef.current = options.onTranscriptPreview;
  }, [options.onTranscriptPreview]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    onVoiceAutoSubmitRef.current = options.onVoiceAutoSubmit;
  }, [options.onVoiceAutoSubmit]);

  useEffect(() => {
    onVoiceSilenceResetRef.current = options.onVoiceSilenceReset;
  }, [options.onVoiceSilenceReset]);

  const setSessionState = useCallback(
    ({
      mode,
      captureActive,
      voiceMuted,
    }: {
      mode: DictationMode | null;
      captureActive: boolean;
      voiceMuted: boolean;
    }) => {
      activeModeRef.current = mode;
      isDictatingRef.current = mode !== null;
      setActiveMode(mode);
      setIsDictating(mode !== null);
      setIsMicCaptureActive(captureActive);
      setIsVoiceMicMuted(mode === "voice" ? voiceMuted : false);
    },
    [],
  );

  const markBrowserStopReason = useCallback(
    (reason: BrowserRecognitionStopReason) => {
      browserRecognitionStopReasonRef.current = reason;
      speechStopRequestedRef.current = reason !== null;
    },
    [],
  );

  const clearBrowserStopReason = useCallback(() => {
    browserRecognitionStopReasonRef.current = null;
    speechStopRequestedRef.current = false;
  }, []);

  const syncGateDebugStats = useCallback(() => {
    const gateState = gateStateRef.current;
    if (!gateState) return;
    getVoiceDebugSink()?.setTranscriptStats({
      committedChars: gateState.transcriptCommitted.length,
      tentativeChars: gateState.transcriptTentative.length,
    });
  }, []);

  const resolveLateFinalWindow = useCallback(
    (turnId: string, nowMs: number): ClosedRealSpeechWindow | null => {
      const window = lastClosedRealSpeechWindowRef.current;
      if (!window) return null;
      if (window.turnId !== turnId || nowMs > window.expiresAtMs) {
        if (nowMs > window.expiresAtMs) {
          lastClosedRealSpeechWindowRef.current = null;
        }
        return null;
      }
      return window;
    },
    [],
  );

  const takePendingFlushSmartTurnOverride = useCallback(
    (
      provider: SttProvider,
      turnId: string,
    ): SmartTurnThresholdOverride | null => {
      const pending = pendingFlushSmartTurnOverrideRef.current;
      if (
        !pending ||
        pending.provider !== provider ||
        pending.turnId !== turnId
      ) {
        return null;
      }
      pendingFlushSmartTurnOverrideRef.current = null;
      return {
        threshold: pending.threshold,
        reason: pending.reason,
      };
    },
    [],
  );

  const clearPendingFlushSmartTurnOverride = useCallback(
    (provider: SttProvider | null, turnId: string | null) => {
      const pending = pendingFlushSmartTurnOverrideRef.current;
      if (
        !pending ||
        pending.provider !== provider ||
        pending.turnId !== turnId
      ) {
        return;
      }
      pendingFlushSmartTurnOverrideRef.current = null;
    },
    [],
  );

  const clearVoiceSilenceResetTimer = useCallback(() => {
    if (voiceSilenceResetTimerRef.current !== null) {
      window.clearTimeout(voiceSilenceResetTimerRef.current);
      voiceSilenceResetTimerRef.current = null;
    }
  }, []);

  const getVoiceBufferState = useCallback(() => {
    const gateState = gateStateRef.current;
    const committed = gateState?.transcriptCommitted?.trim() ?? "";
    const tentative = gateState?.transcriptTentative?.trim() ?? "";
    const hasCommittedText = committed.length > 0;
    const hasTentativeText = tentative.length > 0;
    const hasSmartTurnAudio = smartTurnAudioRef.current.length > 0;
    return {
      hasCommittedText,
      hasTentativeText,
      hasSmartTurnAudio,
      hasAny: hasCommittedText || hasTentativeText || hasSmartTurnAudio,
    };
  }, []);

  const setAvatarPhaseFromVad = useCallback(
    (
      phase: "listening" | "user_speaking" | "semantic_check" | "submitting",
    ) => {
      const runtimeState = useAvatarRuntimeStore.getState();
      if (runtimeState.activeRunId || runtimeState.activeSpeechRunId) {
        return;
      }
      runtimeState.setInteractionPhase(phase);
    },
    [],
  );

  const publishTranscriptPreview = useCallback(
    (args: {
      finalText: string;
      interimText: string;
      turnId?: string | null;
      provider?: SttProvider | null;
      mode?: DictationMode;
    }) => {
      onTranscriptPreviewRef.current?.({
        turnId: args.turnId ?? turnIdRef.current,
        provider: args.provider ?? activeProviderRef.current,
        mode: args.mode ?? modeRef.current,
        finalText: args.finalText,
        interimText: args.interimText,
      });
    },
    [],
  );

  const clearTranscriptPreview = useCallback(
    (args?: {
      turnId?: string | null;
      provider?: SttProvider | null;
      mode?: DictationMode;
    }) => {
      publishTranscriptPreview({
        finalText: "",
        interimText: "",
        turnId: args?.turnId,
        provider: args?.provider,
        mode: args?.mode,
      });
    },
    [publishTranscriptPreview],
  );

  const publishOfflinePreview = useCallback(
    (args: { turnId: string; mode: DictationMode; interimText: string }) => {
      const buffers = browserSpeechTextBuffersRef.current;
      publishTranscriptPreview({
        provider: "parakeet",
        mode: args.mode,
        turnId: args.turnId,
        finalText: buffers?.turnId === args.turnId ? buffers.finalText : "",
        interimText: args.interimText,
      });
    },
    [publishTranscriptPreview],
  );

  /** Remove the interim preview for a window once its final result or rejection arrives. */
  const clearOfflinePreview = useCallback(
    (args: { windowId: string | null; mode: DictationMode }) => {
      const preview = offlinePreviewRef.current;
      if (!preview) return;
      if (args.windowId !== null && preview.windowId !== args.windowId) return;
      offlinePreviewRef.current = null;
      publishOfflinePreview({
        turnId: preview.turnId,
        mode: args.mode,
        interimText: "",
      });
    },
    [publishOfflinePreview],
  );

  const clearBrowserInterimPreview = useCallback(
    (args: {
      reason: string;
      turnId?: string | null;
      provider?: SttProvider | null;
      mode?: DictationMode;
    }) => {
      const turnId = args.turnId ?? turnIdRef.current;
      const provider = args.provider ?? activeProviderRef.current;
      const mode = args.mode ?? modeRef.current;
      const currentBuffers = browserSpeechTextBuffersRef.current;
      const nextBuffers = clearBrowserSpeechInterimText(currentBuffers, turnId);
      browserSpeechTextBuffersRef.current = nextBuffers;
      if (turnId && nextBuffers && nextBuffers.turnId === turnId) {
        publishTranscriptPreview({
          provider,
          mode,
          turnId,
          finalText: nextBuffers.finalText,
          interimText: nextBuffers.interimText,
        });
      } else {
        clearTranscriptPreview({
          turnId,
          provider,
          mode,
        });
      }
      if (nextBuffers !== currentBuffers || !nextBuffers?.interimText) {
        logger.info("BrowserSTT", "Cleared interim transcript preview", {
          reason: args.reason,
          provider,
          mode,
          turnId,
        });
      }
    },
    [clearTranscriptPreview, logger, publishTranscriptPreview],
  );

  const {
    clearPendingVoiceEndTurn,
    hasPendingVoiceEndTurn,
    queuePendingVoiceEndTurn,
    submitPendingVoiceEndTurn,
  } = useVoiceEndTurnCoordinator({
    logger,
    waitMs: SMART_TURN_END_TURN_WAIT_MS,
    getMode: () => modeRef.current,
    getActiveProvider: () => activeProviderRef.current,
    getGateState: () => gateStateRef.current,
    getSpeechBuffers: () => browserSpeechTextBuffersRef.current,
    onSetAvatarPhase: setAvatarPhaseFromVad,
    onRotateTurn: (reason) => rotateVoiceTurnRef.current(reason),
    getOnVoiceAutoSubmit: () => onVoiceAutoSubmitRef.current,
  });

  const teardownVad = useCallback(
    async (reason: string) => {
      const currentVad = vadRef.current;
      vadRef.current = null;
      if (currentVad) {
        try {
          await currentVad.pause();
        } catch (err) {
          logger.warn("VADLifecycle", "Failed to pause acoustic VAD", {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          await currentVad.destroy();
        } catch (err) {
          logger.warn("VADLifecycle", "Failed to destroy acoustic VAD", {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      gateStateRef.current = null;
      browserSpeechTextBuffersRef.current = null;
      turnIdRef.current = null;
      lastClosedRealSpeechWindowRef.current = null;
      lastAcceptedSpeechAtRef.current = null;
      pendingFlushSmartTurnOverrideRef.current = null;
      clearVoiceSilenceResetTimer();
      clearPendingVoiceEndTurn("teardown_vad");
      vadFrameLastPublishedAtRef.current = 0;
      const debugStore = getVoiceDebugSink();
      debugStore?.stopSession();
      debugStore?.clearActiveWindow();
      logger.info("VADLifecycle", "Acoustic VAD stopped", { reason });
    },
    [clearPendingVoiceEndTurn, clearVoiceSilenceResetTimer, logger],
  );

  const suspendVadCapture = useCallback(
    async (reason: string, options?: SuspendVadCaptureOptions) => {
      const currentVad = vadRef.current;
      const shouldFlushPendingSpeech = options?.flushPendingSpeech === true;
      const flushProvider = activeProviderRef.current;
      const flushTurnId = turnIdRef.current;
      vadRef.current = null;
      if (currentVad) {
        if (shouldFlushPendingSpeech) {
          if (flushProvider && flushTurnId) {
            pendingFlushSmartTurnOverrideRef.current = {
              provider: flushProvider,
              turnId: flushTurnId,
              threshold: PTT_RELEASE_SMART_TURN_THRESHOLD,
              reason: "ptt_release",
            };
          }
          currentVad.setOptions({ submitUserSpeechOnPause: true });
        }
        try {
          await currentVad.pause();
        } catch (err) {
          logger.warn("VADLifecycle", "Failed to pause acoustic VAD", {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          await currentVad.destroy();
        } catch (err) {
          logger.warn("VADLifecycle", "Failed to destroy acoustic VAD", {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const gateState = gateStateRef.current;
      if (gateState?.activeWindow) {
        gateStateRef.current = {
          ...gateState,
          activeWindow: null,
          transcriptTentative: "",
        };
      }

      lastClosedRealSpeechWindowRef.current = null;
      clearVoiceSilenceResetTimer();
      vadFrameLastPublishedAtRef.current = 0;

      const debugStore = getVoiceDebugSink();
      debugStore?.clearActiveWindow();
      debugStore?.setStatus("stopped");
      syncGateDebugStats();

      logger.info("VADLifecycle", "Suspended acoustic VAD capture", {
        reason,
        turnId: turnIdRef.current,
        flushedPendingSpeech: shouldFlushPendingSpeech,
      });
      if (shouldFlushPendingSpeech) {
        clearPendingFlushSmartTurnOverride(flushProvider, flushTurnId);
      }
      // A waiting end of turn held for the window just closed can go now.
      void submitPendingVoiceEndTurn("speech_window_update");
    },
    [
      clearPendingFlushSmartTurnOverride,
      clearVoiceSilenceResetTimer,
      logger,
      submitPendingVoiceEndTurn,
      syncGateDebugStats,
    ],
  );

  const resetSmartTurnTurnState = useCallback(
    (reason: string) => {
      smartTurnAudioRef.current = new Float32Array(0);
      smartTurnActiveJobRef.current = null;
      smartTurnJobCounterRef.current = 0;
      const debugStore = getVoiceDebugSink();
      debugStore?.setSmartTurnActiveJob(null);
      debugStore?.setSmartTurnBufferedAudio(null);
      debugStore?.setRollingAudioSamples(0);
      debugStore?.pushSmartTurnEvent({
        type: "buffer_reset",
        turnId: turnIdRef.current,
        jobId: null,
        provider: activeProviderRef.current,
        createdAtMs: Date.now(),
        details: reason,
      });
      logger.info("SmartTurnAudio", "Reset smart-turn turn state", {
        reason,
        turnId: turnIdRef.current,
      });
    },
    [logger],
  );

  const teardownSmartTurn = useCallback(
    async (reason: string) => {
      const debugStore = getVoiceDebugSink();
      const mode = modeRef.current;
      smartTurnWorkerReadyRef.current = false;
      smartTurnActiveJobRef.current = null;
      smartTurnJobCounterRef.current = 0;
      smartTurnAudioRef.current = new Float32Array(0);
      clearPendingVoiceEndTurn("teardown_smart_turn");
      debugStore?.setSmartTurnActiveJob(null);
      debugStore?.setSmartTurnBufferedAudio(null);

      try {
        await disposeSmartTurnWorker();
      } catch (err) {
        logger.warn("SmartTurnWorker", "Failed to dispose smart-turn worker", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (mode === "voice") {
        debugStore?.setSmartTurnStatus("stopped");
      } else {
        debugStore?.resetSmartTurn();
      }

      logger.info("SmartTurnWorker", "Smart-turn worker stopped", {
        reason,
        mode,
      });
    },
    [clearPendingVoiceEndTurn, logger],
  );

  const clearRunIdTimer = () => {
    if (runIdTimerRef.current !== null) {
      window.clearTimeout(runIdTimerRef.current);
      runIdTimerRef.current = null;
    }
  };

  const setRunId = useCallback(
    (runId: string | null, graceMs = RUN_ID_GRACE_MS) => {
      runIdRef.current = runId;
      clearRunIdTimer();
      if (runId) {
        runIdTimerRef.current = window.setTimeout(() => {
          runIdRef.current = null;
          runIdTimerRef.current = null;
        }, graceMs);
      }
    },
    [],
  );

  const rotateVoiceTurn = useCallback(
    (reason: string) => {
      const provider = activeProviderRef.current;
      if (!provider) {
        return;
      }

      clearVoiceSilenceResetTimer();
      const nextTurnId = createTurnId();
      turnIdRef.current = nextTurnId;
      gateStateRef.current = startAcousticTurn(nextTurnId);
      browserSpeechTextBuffersRef.current =
        createBrowserSpeechTextBuffers(nextTurnId);
      clearTranscriptPreview({
        provider,
        mode: modeRef.current,
        turnId: nextTurnId,
      });
      lastClosedRealSpeechWindowRef.current = null;
      lastAcceptedSpeechAtRef.current = null;
      syncGateDebugStats();
      const debugStore = getVoiceDebugSink();
      debugStore?.setTurnContext({ provider, turnId: nextTurnId });
      if (modeRef.current === "voice") {
        resetSmartTurnTurnState(reason);
        debugStore?.setSmartTurnEnabled(true);
        debugStore?.setSmartTurnStatus(
          smartTurnWorkerReadyRef.current ? "ready" : "loading",
        );
      }
      logger.info("Turn", "Rotated voice turn", {
        provider,
        turnId: nextTurnId,
        reason,
      });
    },
    [
      clearTranscriptPreview,
      clearVoiceSilenceResetTimer,
      logger,
      resetSmartTurnTurnState,
      syncGateDebugStats,
    ],
  );

  rotateVoiceTurnRef.current = rotateVoiceTurn;

  const armVoiceSilenceResetTimer = useCallback(
    (reason: string, delayMs = VOICE_SILENCE_RESET_MS) => {
      clearVoiceSilenceResetTimer();
      if (modeRef.current !== "voice") return;
      const provider = activeProviderRef.current;
      if (!provider) return;

      const bufferState = getVoiceBufferState();
      if (!bufferState.hasAny) return;
      const armedAtMs = Date.now();

      voiceSilenceResetTimerRef.current = window.setTimeout(() => {
        voiceSilenceResetTimerRef.current = null;

        if (!isDictatingRef.current || modeRef.current !== "voice") {
          return;
        }
        const currentProvider = activeProviderRef.current;
        if (!currentProvider) {
          return;
        }
        if (gateStateRef.current?.activeWindow) {
          return;
        }

        const nextBufferState = getVoiceBufferState();
        if (!nextBufferState.hasAny) {
          return;
        }

        if (smartTurnActiveJobRef.current) {
          logger.info(
            "VoiceSilence",
            "Deferring silence reset while smart-turn job is active",
            {
              provider: currentProvider,
              turnId: turnIdRef.current,
              jobId: smartTurnActiveJobRef.current.jobId,
              reason,
            },
          );
          armVoiceSilenceResetTimer(
            "smart_turn_job_active",
            VOICE_SILENCE_RESET_DEFER_MS,
          );
          return;
        }

        if (hasPendingVoiceEndTurn()) {
          logger.info(
            "VoiceSilence",
            "Deferring silence reset while end-turn auto-submit is pending",
            {
              provider: currentProvider,
              turnId: turnIdRef.current,
              reason,
            },
          );
          armVoiceSilenceResetTimer(
            "smart_turn_submit_pending",
            VOICE_SILENCE_RESET_DEFER_MS,
          );
          return;
        }

        const turnId = turnIdRef.current ?? "unknown-turn";
        const silenceMs =
          lastAcceptedSpeechAtRef.current !== null
            ? Date.now() - lastAcceptedSpeechAtRef.current
            : Date.now() - armedAtMs;

        logger.info("VoiceSilence", "Resetting voice buffers after silence", {
          provider: currentProvider,
          turnId,
          silenceMs,
          reason,
          hadCommittedText: nextBufferState.hasCommittedText,
          hadTentativeText: nextBufferState.hasTentativeText,
          hadSmartTurnAudio: nextBufferState.hasSmartTurnAudio,
        });

        onVoiceSilenceResetRef.current?.({
          turnId,
          silenceMs,
          hadCommittedText: nextBufferState.hasCommittedText,
          hadTentativeText: nextBufferState.hasTentativeText,
          hadSmartTurnAudio: nextBufferState.hasSmartTurnAudio,
          reason: "silence_timeout_6s",
        });

        rotateVoiceTurn("silence_timeout_6s");
      }, delayMs);

      logger.info("VoiceSilence", "Armed voice silence reset timer", {
        provider,
        turnId: turnIdRef.current,
        reason,
        delayMs,
        hasCommittedText: bufferState.hasCommittedText,
        hasTentativeText: bufferState.hasTentativeText,
        hasSmartTurnAudio: bufferState.hasSmartTurnAudio,
      });
    },
    [
      clearVoiceSilenceResetTimer,
      getVoiceBufferState,
      hasPendingVoiceEndTurn,
      logger,
      rotateVoiceTurn,
    ],
  );

  const teardownBrowserVisualizerStream = useCallback(() => {
    const visualizerStream = browserVisualizerStreamRef.current;
    if (!visualizerStream) return;
    for (const track of visualizerStream.getTracks()) {
      track.stop();
    }
    browserVisualizerStreamRef.current = null;
    setStream((current) => (current === visualizerStream ? null : current));
  }, [setStream]);

  const clearBrowserRecognitionHandlers = useCallback(
    (recognition: BrowserSpeechRecognition | null = recognitionRef.current) => {
      if (!recognition) return;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    },
    [],
  );

  /**
   * End browser recognition and wait for its `end` event. With `finalize`,
   * the recognizer first returns results for audio it already heard;
   * otherwise it is aborted and returns nothing more.
   */
  const stopBrowserRecognition = useCallback(
    async (options?: { finalize?: boolean }) => {
      const recognition = recognitionRef.current;
      if (!recognition) return;

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          recognition.removeEventListener("end", onEnd);
          resolve();
        };

        const onEnd = () => {
          finish();
        };

        const timeoutId = window.setTimeout(() => {
          logger.warn(
            "BrowserSTT",
            "Timed out waiting for browser recognition end",
          );
          finish();
        }, BROWSER_RECOGNITION_END_WAIT_MS);

        recognition.addEventListener("end", onEnd, { once: true });

        try {
          if (!options?.finalize && typeof recognition.abort === "function") {
            recognition.abort();
          } else {
            recognition.stop();
          }
        } catch (err) {
          logger.warn("BrowserSTT", "Failed to stop browser recognition", {
            error: err instanceof Error ? err.message : String(err),
          });
          finish();
        }
      });
    },
    [logger],
  );

  /**
   * Close any open speech window as a finished utterance: pausing MicVAD with
   * submit-on-pause emits its speech end, which queues its transcription.
   */
  const flushOpenSpeechWindow = useCallback(
    async (reason: string) => {
      const currentVad = vadRef.current;
      if (!currentVad) return;
      currentVad.setOptions({ submitUserSpeechOnPause: true });
      try {
        await currentVad.pause();
      } catch (err) {
        logger.warn("VADLifecycle", "Failed to flush acoustic VAD", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [logger],
  );

  const runSmartTurnSemanticCheck = useCallback(
    async (args: {
      provider: VoiceSttProvider;
      turnId: string;
      thresholdOverride?: SmartTurnThresholdOverride | null;
    }) => {
      if (modeRef.current !== "voice") return;
      if (!smartTurnWorkerReadyRef.current) return;

      const runtimeState = useAvatarRuntimeStore.getState();
      if (runtimeState.activeRunId || runtimeState.activeSpeechRunId) {
        logger.info(
          "SmartTurnJob",
          "Skipped smart-turn job because assistant run is active",
          {
            provider: args.provider,
            turnId: args.turnId,
            activeRunId: runtimeState.activeRunId,
            activeSpeechRunId: runtimeState.activeSpeechRunId,
          },
        );
        return;
      }

      const turnAudio = smartTurnAudioRef.current;
      if (turnAudio.length <= 0) return;
      const modelAudioWindow = buildSmartTurnModelAudioWindow(turnAudio);
      const thresholdOverride =
        args.thresholdOverride ??
        takePendingFlushSmartTurnOverride(args.provider, args.turnId);
      const smartTurnThreshold =
        thresholdOverride?.threshold ?? SMART_TURN_THRESHOLD;

      const previousJob = smartTurnActiveJobRef.current;
      const debugStore = getVoiceDebugSink();
      if (previousJob) {
        debugStore?.incrementSmartTurnSuperseded();
        debugStore?.pushSmartTurnEvent({
          type: "job_superseded",
          turnId: args.turnId,
          jobId: previousJob.jobId,
          provider: args.provider,
          createdAtMs: Date.now(),
          details: "Newer audio arrived before previous result.",
        });
        logger.info("SmartTurnJob", "Superseded smart-turn job", {
          provider: args.provider,
          turnId: args.turnId,
          supersededJobId: previousJob.jobId,
          supersededSequence: previousJob.sequence,
        });
      }

      const jobId = createJobId();
      const jobSequence = smartTurnJobCounterRef.current + 1;
      smartTurnJobCounterRef.current = jobSequence;
      smartTurnActiveJobRef.current = {
        jobId,
        sequence: jobSequence,
      };

      debugStore?.setSmartTurnActiveJob(jobId);
      debugStore?.setSmartTurnStatus("running");
      debugStore?.pushSmartTurnEvent({
        type: "job_queued",
        turnId: args.turnId,
        jobId,
        provider: args.provider,
        createdAtMs: Date.now(),
        details: `samples=${turnAudio.length} threshold=${smartTurnThreshold}${thresholdOverride ? ` reason=${thresholdOverride.reason}` : ""}`,
      });
      logger.info("SmartTurnJob", "Queued smart-turn job", {
        provider: args.provider,
        turnId: args.turnId,
        jobId,
        sequence: jobSequence,
        inputSamples: turnAudio.length,
        threshold: smartTurnThreshold,
        thresholdOverrideReason: thresholdOverride?.reason ?? null,
      });

      setAvatarPhaseFromVad("semantic_check");
      const jobStartedAtMs = performance.now();

      try {
        debugStore?.pushSmartTurnEvent({
          type: "job_running",
          turnId: args.turnId,
          jobId,
          provider: args.provider,
          createdAtMs: Date.now(),
          details: null,
        });

        const result = await predictSmartTurn({
          jobId,
          turnId: args.turnId,
          audio: turnAudio,
          sampleRateHz: SMART_TURN_SAMPLE_RATE,
          threshold: smartTurnThreshold,
        });

        const activeJob = smartTurnActiveJobRef.current;
        if (
          !activeJob ||
          activeJob.jobId !== jobId ||
          activeJob.sequence !== jobSequence
        ) {
          logger.info(
            "SmartTurnJob",
            "Ignored stale smart-turn result after supersession",
            {
              provider: args.provider,
              turnId: args.turnId,
              jobId,
              sequence: jobSequence,
            },
          );
          return;
        }

        smartTurnActiveJobRef.current = null;
        debugStore?.setSmartTurnActiveJob(null);
        debugStore?.setSmartTurnStatus("ready");
        const audioDurationMs = Math.round(
          (turnAudio.length / SMART_TURN_SAMPLE_RATE) * 1000,
        );
        const isShortUtterance =
          audioDurationMs < SMART_TURN_SHORT_UTTERANCE_MAX_MS;
        const speechBuffers = browserSpeechTextBuffersRef.current;
        const canApplyShortUtteranceOverride =
          result.decision !== "end_turn" &&
          isShortUtterance &&
          speechBuffers?.turnId === args.turnId;

        let shortUtteranceOverrideMatched = false;
        let shortUtteranceOverrideSource: "final" | "interim" | null = null;
        let shortUtteranceOverridePhrase = "";
        if (canApplyShortUtteranceOverride) {
          const normalizedFinal = normalizeSmartTurnOverrideText(
            speechBuffers?.finalText ?? "",
          );
          const normalizedInterim = normalizeSmartTurnOverrideText(
            speechBuffers?.interimText ?? "",
          );
          if (
            normalizedFinal &&
            SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET.has(normalizedFinal)
          ) {
            shortUtteranceOverrideMatched = true;
            shortUtteranceOverrideSource = "final";
            shortUtteranceOverridePhrase = normalizedFinal;
          } else if (
            normalizedInterim &&
            SMART_TURN_FORCE_END_TURN_SHORT_UTTERANCE_SET.has(normalizedInterim)
          ) {
            shortUtteranceOverrideMatched = true;
            shortUtteranceOverrideSource = "interim";
            shortUtteranceOverridePhrase = normalizedInterim;
          }
        }

        const effectiveDecision =
          result.decision === "end_turn" || shortUtteranceOverrideMatched
            ? "end_turn"
            : "continue";
        debugStore?.setSmartTurnLatestDecision({
          turnId: args.turnId,
          jobId,
          decision: effectiveDecision,
          probability: result.probability,
          threshold: result.threshold,
          latencyMs: result.latencyMs,
          createdAtMs: Date.now(),
        });
        debugStore?.pushSmartTurnEvent({
          type: "job_completed",
          turnId: args.turnId,
          jobId,
          provider: args.provider,
          createdAtMs: Date.now(),
          details: `${effectiveDecision} (model=${result.decision}) p=${result.probability.toFixed(3)} threshold=${result.threshold.toFixed(3)} latency=${result.latencyMs}ms${thresholdOverride ? ` threshold_reason=${thresholdOverride.reason}` : ""}${shortUtteranceOverrideMatched ? ` override=${shortUtteranceOverrideSource}:${shortUtteranceOverridePhrase}` : ""}`,
          probability: result.probability,
          audio: {
            sampleRateHz: SMART_TURN_SAMPLE_RATE,
            samples: modelAudioWindow,
          },
        });

        logger.info("SmartTurnDecision", "Smart-turn decision ready", {
          provider: args.provider,
          turnId: args.turnId,
          jobId,
          decision: effectiveDecision,
          modelDecision: result.decision,
          shortUtteranceOverrideMatched,
          shortUtteranceOverrideSource,
          shortUtteranceOverridePhrase: shortUtteranceOverridePhrase || null,
          audioDurationMs,
          probability: result.probability,
          threshold: result.threshold,
          thresholdOverrideReason: thresholdOverride?.reason ?? null,
          latencyMs: result.latencyMs,
          preprocessMs: result.preprocessMs,
          inferenceMs: result.inferenceMs,
          inputShape: result.inputShape,
          paddedLeadingSamples: result.paddedLeadingSamples,
          truncatedLeadingSamples: result.truncatedLeadingSamples,
        });

        if (shortUtteranceOverrideMatched) {
          logger.info(
            "SmartTurnDecision",
            "Forced end_turn via short-utterance override",
            {
              provider: args.provider,
              turnId: args.turnId,
              jobId,
              source: shortUtteranceOverrideSource,
              phrase: shortUtteranceOverridePhrase,
              audioDurationMs,
              maxDurationMs: SMART_TURN_SHORT_UTTERANCE_MAX_MS,
              modelDecision: result.decision,
              probability: result.probability,
            },
          );
        }

        if (effectiveDecision !== "end_turn") {
          setAvatarPhaseFromVad("listening");
          return;
        }

        await queuePendingVoiceEndTurn({
          provider: args.provider,
          turnId: args.turnId,
          jobId,
          probability: result.probability,
          threshold: result.threshold,
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (smartTurnActiveJobRef.current?.jobId !== jobId) {
          // A newer job, a turn rotation or a stop already replaced this job.
          logger.info(
            "SmartTurnJob",
            "Ignored smart-turn failure after supersession",
            { provider: args.provider, turnId: args.turnId, jobId },
          );
          return;
        }
        smartTurnActiveJobRef.current = null;
        debugStore?.setSmartTurnActiveJob(null);
        debugStore?.setSmartTurnStatus("error");
        debugStore?.setSmartTurnError(errorMessage);
        debugStore?.pushSmartTurnEvent({
          type: "job_error",
          turnId: args.turnId,
          jobId,
          provider: args.provider,
          createdAtMs: Date.now(),
          details: errorMessage,
        });
        logger.error("SmartTurnJob", "Smart-turn inference failed", err);
        logger.warn("SmartTurnJob", "Smart-turn inference context", {
          provider: args.provider,
          turnId: args.turnId,
          jobId,
          error: errorMessage,
        });
        // Without a semantic decision, the acoustic end of speech ends the
        // turn, so the words are sent instead of waiting for the silence reset
        // to drop them.
        await queuePendingVoiceEndTurn({
          provider: args.provider,
          turnId: args.turnId,
          jobId,
          probability: null,
          threshold: smartTurnThreshold,
          latencyMs: Math.round(performance.now() - jobStartedAtMs),
          source: "acoustic_fallback",
        });
      }
    },
    [
      logger,
      queuePendingVoiceEndTurn,
      setAvatarPhaseFromVad,
      takePendingFlushSmartTurnOverride,
    ],
  );

  const stopDictationNow = useCallback(
    async (options?: StopDictationOptions) => {
      const provider = activeProviderRef.current;
      // Stopping dictation keeps the sentence being spoken: the open window and
      // any window still being transcribed reach the composer first. Leaving
      // Voice Mode discards an unfinished turn instead.
      const finishSpokenText =
        options?.finishSpokenText !== false && modeRef.current === "dictation";
      logger.info("State", "Stopping dictation", {
        runId: runIdRef.current,
        provider,
        finishSpokenText,
      });
      clearVoiceSilenceResetTimer();
      lastAcceptedSpeechAtRef.current = null;

      if (provider === "parakeet") {
        if (finishSpokenText) {
          await flushOpenSpeechWindow("stop-parakeet");
          const settled = await offlineTranscriptionsRef.current.settle(
            OFFLINE_STOP_TRANSCRIPTION_WAIT_MS,
          );
          if (!settled) {
            logger.warn(
              "OfflineSTT",
              "Stopped before every speech window was transcribed",
              { waitMs: OFFLINE_STOP_TRANSCRIPTION_WAIT_MS },
            );
          }
        }
        clearTranscriptPreview({
          provider,
          mode: modeRef.current,
          turnId: turnIdRef.current,
        });
        const runId = runIdRef.current;
        activeOfflineSessionIdRef.current = null;
        offlinePreviewControllerRef.current?.reset();
        offlinePreviewControllerRef.current = null;
        offlinePreviewRef.current = null;
        setIsDictationPreparing(false);
        setRunId(null);
        teardownBrowserVisualizerStream();
        await teardownVad("stop-parakeet");
        await teardownSmartTurn("stop-parakeet");
        logger.info("State", "Dictation stopped", { runId, provider });
      } else {
        markBrowserStopReason("stop");
        if (finishSpokenText) {
          await flushOpenSpeechWindow("stop-browser");
          // Accept the just-spoken phrase's final result for as long as the
          // recognizer may take to deliver it.
          const closedWindow = lastClosedRealSpeechWindowRef.current;
          if (closedWindow && closedWindow.turnId === turnIdRef.current) {
            lastClosedRealSpeechWindowRef.current = {
              ...closedWindow,
              expiresAtMs: Date.now() + BROWSER_RECOGNITION_END_WAIT_MS,
            };
          }
        }
        await stopBrowserRecognition({ finalize: finishSpokenText });
        const buffers = browserSpeechTextBuffersRef.current;
        const unfinalizedText =
          finishSpokenText && buffers?.turnId === turnIdRef.current
            ? buffers.interimText.trim()
            : "";
        if (unfinalizedText) {
          // The recognizer ended without finalizing these words; keep them as
          // they were shown rather than dropping them from the composer.
          onSegmentRef.current?.({
            text: unfinalizedText,
            isFinal: true,
            runId: null,
            turnId: buffers?.turnId ?? null,
            source: "browser_web_speech",
          });
        }
        clearTranscriptPreview({
          provider,
          mode: modeRef.current,
          turnId: turnIdRef.current,
        });
        clearBrowserRecognitionHandlers();
        teardownBrowserVisualizerStream();
        await teardownVad("stop-browser");
        await teardownSmartTurn("stop-browser");
        setRunId(null);
        logger.info("State", "Browser dictation stopped", { provider });
      }

      activeProviderRef.current = null;
      modeRef.current = "dictation";
      clearBrowserStopReason();
      setSessionState({
        mode: null,
        captureActive: false,
        voiceMuted: false,
      });
      if (provider === "parakeet" && offlineRouteRef.current) {
        offlineSttClients[offlineRouteRef.current.engine].armIdleDispose(
          "stop-offline",
        );
      }
    },
    [
      clearBrowserStopReason,
      clearVoiceSilenceResetTimer,
      clearBrowserRecognitionHandlers,
      clearTranscriptPreview,
      flushOpenSpeechWindow,
      logger,
      markBrowserStopReason,
      setSessionState,
      setRunId,
      stopBrowserRecognition,
      teardownBrowserVisualizerStream,
      teardownSmartTurn,
      teardownVad,
    ],
  );

  const stopDictation = useCallback(
    async (options?: StopDictationOptions) => {
      // A stop that is still finishing the spoken text owns the session.
      if (stopInFlightRef.current) return stopInFlightRef.current;
      if (
        !isDictatingRef.current &&
        !recognitionRef.current &&
        !browserVisualizerStreamRef.current
      ) {
        return;
      }
      const stopping = stopDictationNow(options);
      stopInFlightRef.current = stopping;
      try {
        await stopping;
      } finally {
        stopInFlightRef.current = null;
      }
    },
    [stopDictationNow],
  );

  const muteVoiceMic = useCallback(
    async (options?: MuteVoiceMicOptions) => {
      if (activeModeRef.current !== "voice" || isVoiceMicMuted) {
        return;
      }

      const provider = activeProviderRef.current;
      if (!provider) {
        return;
      }

      logger.info("State", "Muting voice capture", {
        provider,
        turnId: turnIdRef.current,
        flushPendingSpeech: options?.flushPendingSpeech === true,
      });
      if (provider !== "parakeet") {
        clearBrowserInterimPreview({
          reason: "voice_mute",
          turnId: turnIdRef.current,
          provider,
          mode: "voice",
        });
      } else {
        // Pausing MicVAD without a flush discards the open window without any
        // VAD callback, so previews must end here. A flushed window keeps its
        // preview until the final that `onSpeechEnd` queues replaces it.
        offlinePreviewControllerRef.current?.reset();
        if (options?.flushPendingSpeech !== true) {
          clearOfflinePreview({ windowId: null, mode: "voice" });
        }
      }
      clearVoiceSilenceResetTimer();
      lastAcceptedSpeechAtRef.current = null;
      lastClosedRealSpeechWindowRef.current = null;
      await suspendVadCapture("voice-mute", {
        flushPendingSpeech: options?.flushPendingSpeech === true,
      });
      if (provider === "parakeet") {
        setIsDictationPreparing(false);
      } else {
        markBrowserStopReason("pause");
        await stopBrowserRecognition();
        clearBrowserRecognitionHandlers();
      }
      teardownBrowserVisualizerStream();
      setSessionState({
        mode: "voice",
        captureActive: false,
        voiceMuted: true,
      });
    },
    [
      clearBrowserInterimPreview,
      clearOfflinePreview,
      clearVoiceSilenceResetTimer,
      isVoiceMicMuted,
      logger,
      markBrowserStopReason,
      setSessionState,
      stopBrowserRecognition,
      suspendVadCapture,
      teardownBrowserVisualizerStream,
      clearBrowserRecognitionHandlers,
    ],
  );

  const appendSmartTurnAudioSegment = useCallback(
    (args: {
      provider: VoiceSttProvider;
      turnId: string;
      audio: Float32Array;
    }) => {
      if (args.audio.length <= 0) return;
      const nextAudio = new Float32Array(
        smartTurnAudioRef.current.length + args.audio.length,
      );
      nextAudio.set(smartTurnAudioRef.current);
      nextAudio.set(args.audio, smartTurnAudioRef.current.length);
      smartTurnAudioRef.current = nextAudio;
      const debugStore = getVoiceDebugSink();
      debugStore?.setSmartTurnBufferedAudio({
        sampleRateHz: SMART_TURN_SAMPLE_RATE,
        samples: nextAudio,
      });
      logger.info("SmartTurnAudio", "Appended voiced audio segment", {
        provider: args.provider,
        turnId: args.turnId,
        segmentSamples: args.audio.length,
        bufferedSamples: nextAudio.length,
      });
    },
    [logger],
  );

  const commitOfflineVoiceTranscript = useCallback(
    (args: { turnId: string; text: string }) => {
      const text = args.text.trim();
      if (!text) return;

      const gateState = gateStateRef.current;
      if (gateState?.turnId === args.turnId) {
        gateStateRef.current = {
          ...gateState,
          transcriptCommitted: appendTranscript(
            gateState.transcriptCommitted,
            text,
          ),
          transcriptTentative: "",
        };
        syncGateDebugStats();
      }

      const nextBuffers = updateBrowserSpeechTextBuffers({
        current: browserSpeechTextBuffersRef.current,
        turnId: args.turnId,
        finalSegments: [text],
        interimSegments: [],
      });
      browserSpeechTextBuffersRef.current = nextBuffers;
      // A later window may already be previewing while this final lands.
      const preview = offlinePreviewRef.current;
      publishTranscriptPreview({
        provider: "parakeet",
        mode: "voice",
        turnId: args.turnId,
        finalText: nextBuffers.finalText,
        interimText: preview?.turnId === args.turnId ? preview.text : "",
      });
    },
    [publishTranscriptPreview, syncGateDebugStats],
  );

  const transcribeOfflineSpeechWindow = useCallback(
    async (args: {
      sessionId: number;
      route: OfflineSpeechRoute;
      runId: string;
      turnId: string;
      windowId: string;
      mode: DictationMode;
      audio: Float32Array;
      thresholdOverride?: SmartTurnThresholdOverride | null;
    }) => {
      const jobId = createJobId();
      offlineJobCounterRef.current += 1;
      const sequence = offlineJobCounterRef.current;

      logger.info("OfflineSTT", "Queued speech window transcription", {
        jobId,
        sequence,
        runId: args.runId,
        turnId: args.turnId,
        windowId: args.windowId,
        samples: args.audio.length,
        smartTurnThresholdOverride: args.thresholdOverride?.threshold ?? null,
        smartTurnThresholdOverrideReason:
          args.thresholdOverride?.reason ?? null,
      });

      try {
        const result = await offlineSttClients[args.route.engine].transcribe({
          jobId,
          runId: args.runId,
          turnId: args.turnId,
          windowId: args.windowId,
          audio: args.audio,
          sampleRateHz: DEFAULT_SAMPLE_RATE,
          language: args.route.language,
        });

        if (
          activeOfflineSessionIdRef.current !== args.sessionId ||
          activeProviderRef.current !== "parakeet" ||
          modeRef.current !== args.mode ||
          runIdRef.current !== args.runId ||
          turnIdRef.current !== args.turnId ||
          !isDictatingRef.current
        ) {
          logger.info(
            "OfflineSTT",
            "Ignored stale speech window transcription",
            {
              jobId,
              runId: args.runId,
              turnId: args.turnId,
              windowId: args.windowId,
            },
          );
          return;
        }

        clearOfflinePreview({ windowId: args.windowId, mode: args.mode });

        logger.info("OfflineSTT", "Speech window transcription ready", {
          jobId,
          runId: result.runId,
          turnId: result.turnId,
          windowId: result.windowId,
          textLength: result.text.length,
          audioDurationMs: result.audioDurationMs,
          transcribeMs: result.transcribeMs,
          metrics: result.metrics,
        });

        if (args.mode === "voice") {
          const runtimeState = useAvatarRuntimeStore.getState();
          if (runtimeState.activeRunId || runtimeState.activeSpeechRunId) {
            logger.info(
              "OfflineSTT",
              "Ignored speech window transcription while assistant run is active",
              {
                jobId,
                runId: result.runId,
                turnId: result.turnId,
                windowId: result.windowId,
                activeRunId: runtimeState.activeRunId,
                activeSpeechRunId: runtimeState.activeSpeechRunId,
              },
            );
            return;
          }

          if (result.text) {
            commitOfflineVoiceTranscript({
              turnId: result.turnId,
              text: result.text,
            });
            onSegmentRef.current?.({
              text: result.text,
              isFinal: true,
              runId: null,
              turnId: result.turnId,
              source: args.route.engine,
            });
            void submitPendingVoiceEndTurn("transcript_update");
          }

          appendSmartTurnAudioSegment({
            provider: "parakeet",
            turnId: result.turnId,
            audio: args.audio,
          });

          if (smartTurnWorkerReadyRef.current) {
            await runSmartTurnSemanticCheck({
              provider: "parakeet",
              turnId: result.turnId,
              thresholdOverride: args.thresholdOverride,
            });
          } else {
            logger.warn(
              "SmartTurnJob",
              "Skipped smart-turn job because worker is not ready",
              {
                provider: "parakeet",
                turnId: result.turnId,
              },
            );
          }
          armVoiceSilenceResetTimer("parakeet_speech_window_complete");
          return;
        }

        if (!result.text) return;
        onSegmentRef.current?.({
          text: result.text,
          isFinal: true,
          runId: result.runId,
          turnId: result.turnId,
          source: args.route.engine,
        });
      } catch (err) {
        if (
          activeOfflineSessionIdRef.current !== args.sessionId ||
          activeProviderRef.current !== "parakeet" ||
          modeRef.current !== args.mode ||
          !isDictatingRef.current
        ) {
          return;
        }
        clearOfflinePreview({ windowId: args.windowId, mode: args.mode });
        const errorObj =
          err instanceof Error
            ? err
            : new WordedError(dictationErrorText("transcriptionFailed"));
        setError(errorObj);
        onErrorRef.current?.(errorObj);
        getVoiceDebugSink()?.setError(errorObj.message);
        logger.error(
          "OfflineSTT",
          "Speech window transcription failed",
          errorObj,
        );
      }
    },
    [
      appendSmartTurnAudioSegment,
      armVoiceSilenceResetTimer,
      clearOfflinePreview,
      commitOfflineVoiceTranscript,
      logger,
      runSmartTurnSemanticCheck,
      submitPendingVoiceEndTurn,
    ],
  );

  /**
   * Create the live-preview controller for one offline capture session. Preview
   * text is display-only and is dropped whenever the session, mode, run or turn
   * has moved on, or an assistant run owns the Voice Mode floor.
   */
  const createOfflinePreviewSession = useCallback(
    (args: {
      sessionId: number;
      route: OfflineSpeechRoute;
      runId: string;
      mode: DictationMode;
      backend: OfflineSttBackend;
    }): SpeechPreviewController | null => {
      offlinePreviewControllerRef.current?.reset();
      offlinePreviewControllerRef.current = null;
      clearOfflinePreview({ windowId: null, mode: args.mode });
      if (!shouldEnableSpeechPreviews(args.backend)) return null;

      const isCurrentSession = (turnId: string) =>
        activeOfflineSessionIdRef.current === args.sessionId &&
        activeProviderRef.current === "parakeet" &&
        modeRef.current === args.mode &&
        runIdRef.current === args.runId &&
        turnIdRef.current === turnId &&
        isDictatingRef.current;
      // Voice Mode yields to the assistant's run and speech, like final text.
      const canShowPreview = (turnId: string) => {
        if (!isCurrentSession(turnId)) return false;
        if (args.mode !== "voice") return true;
        const runtimeState = useAvatarRuntimeStore.getState();
        return !runtimeState.activeRunId && !runtimeState.activeSpeechRunId;
      };

      const controller = createSpeechPreviewController({
        config: {
          ...DEFAULT_SPEECH_PREVIEW_CONFIG,
          sampleRateHz: DEFAULT_SAMPLE_RATE,
          preSpeechPadMs: MICVAD_PRESPEECH_PAD_MS,
        },
        now: () => performance.now(),
        transcribe: async ({ turnId, windowId, audio }) => {
          const result = await offlineSttClients[args.route.engine].transcribe({
            kind: "preview",
            jobId: createJobId(),
            runId: args.runId,
            turnId,
            windowId,
            audio,
            sampleRateHz: DEFAULT_SAMPLE_RATE,
            language: args.route.language,
          });
          return { text: result.text, decodeMs: result.transcribeMs };
        },
        shouldPreview: canShowPreview,
        onPreview: (preview) => {
          if (!canShowPreview(preview.turnId)) return;
          offlinePreviewRef.current = preview;
          publishOfflinePreview({
            turnId: preview.turnId,
            mode: args.mode,
            interimText: preview.text,
          });
        },
        onEvent: (event) => {
          if (event.type === "preview_ready") {
            logger.debug("OfflineSTT", "Preview transcription ready", {
              ...event,
            });
            return;
          }
          logger.info(
            "OfflineSTT",
            event.type === "budget_exceeded"
              ? "Stopped previews for a speech window over the decode budget"
              : "Preview transcription failed; stopped previews for the window",
            { ...event },
          );
        },
      });
      offlinePreviewControllerRef.current = controller;
      return controller;
    },
    [clearOfflinePreview, logger, publishOfflinePreview],
  );

  const startOfflineVisualizerStream = useCallback(
    async (sessionId: number) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        return;
      }
      try {
        const visualizerStream = await openSelectedMicrophone();

        if (
          activeOfflineSessionIdRef.current !== sessionId ||
          activeProviderRef.current !== "parakeet"
        ) {
          for (const track of visualizerStream.getTracks()) {
            track.stop();
          }
          return;
        }

        teardownBrowserVisualizerStream();
        browserVisualizerStreamRef.current = visualizerStream;
        setStream(visualizerStream);
      } catch (err) {
        logger.warn("OfflineSTT", "Visualizer stream unavailable", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [logger, setStream, teardownBrowserVisualizerStream],
  );

  const startOfflineDictation = useCallback(
    async (
      mode: DictationMode = "dictation",
      options?: {
        reuseTurnState?: boolean;
        reuseSmartTurnWorker?: boolean;
      },
    ) => {
      const route = offlineRouteRef.current;
      if (!route) throw new Error("Offline speech started without a route.");
      const client = offlineSttClients[route.engine];
      await client.cancelIdleDispose(`start-offline-${mode}`);

      const canReuseTurnState =
        options?.reuseTurnState === true &&
        Boolean(turnIdRef.current && gateStateRef.current);
      const reuseSmartTurnWorker =
        canReuseTurnState &&
        mode === "voice" &&
        options?.reuseSmartTurnWorker === true &&
        smartTurnWorkerReadyRef.current;
      const sessionId =
        canReuseTurnState && activeOfflineSessionIdRef.current !== null
          ? activeOfflineSessionIdRef.current
          : offlineSessionCounterRef.current + 1;
      offlineSessionCounterRef.current = Math.max(
        offlineSessionCounterRef.current,
        sessionId,
      );
      activeOfflineSessionIdRef.current = sessionId;
      offlineJobCounterRef.current = 0;
      activeProviderRef.current = "parakeet";
      modeRef.current = mode;
      setIsDictationPreparing(true);
      setSessionState({
        mode,
        captureActive: false,
        voiceMuted: false,
      });
      clearTranscriptPreview({
        mode,
        provider: "parakeet",
        turnId: canReuseTurnState ? turnIdRef.current : null,
      });
      clearVoiceSilenceResetTimer();
      lastAcceptedSpeechAtRef.current = null;

      if (canReuseTurnState) {
        await suspendVadCapture("resume-offline");
      } else {
        await teardownVad(`start-parakeet-${mode}`);
        await teardownSmartTurn(`start-parakeet-${mode}`);
      }
      teardownBrowserVisualizerStream();

      const runId =
        canReuseTurnState && runIdRef.current
          ? runIdRef.current
          : createRunId();
      const turnId =
        canReuseTurnState && turnIdRef.current
          ? turnIdRef.current
          : createTurnId();
      clearRunIdTimer();
      runIdRef.current = runId;
      turnIdRef.current = turnId;
      if (!canReuseTurnState) {
        gateStateRef.current = startAcousticTurn(turnId);
        browserSpeechTextBuffersRef.current =
          mode === "voice" ? createBrowserSpeechTextBuffers(turnId) : null;
        lastClosedRealSpeechWindowRef.current = null;
        smartTurnAudioRef.current = new Float32Array(0);
        smartTurnActiveJobRef.current = null;
        smartTurnJobCounterRef.current = 0;
      }

      const debugStore = getVoiceDebugSink();
      if (canReuseTurnState) {
        debugStore?.setTurnContext({ provider: "parakeet", turnId });
      } else {
        debugStore?.reset();
        debugStore?.startSession({
          provider: "parakeet",
          turnId,
        });
      }
      debugStore?.setSmartTurnEnabled(mode === "voice");
      debugStore?.setSmartTurnStatus(
        mode === "voice"
          ? reuseSmartTurnWorker
            ? "ready"
            : "loading"
          : "idle",
      );
      syncGateDebugStats();

      try {
        logger.info("OfflineSTT", "Loading offline speech runtime", {
          engine: route.engine,
          language: route.language,
          runId,
          turnId,
          sessionId,
          mode,
          reusedTurnState: canReuseTurnState,
        });
        if (
          typeof window === "undefined" ||
          typeof AudioWorkletNode !== "function"
        ) {
          throw new WordedError(dictationErrorText("audioWorkletOffline"));
        }

        const isCurrentOfflineStart = () =>
          activeOfflineSessionIdRef.current === sessionId &&
          activeProviderRef.current === "parakeet" &&
          modeRef.current === mode &&
          runIdRef.current === runId &&
          turnIdRef.current === turnId;

        const offlineLoadPromise = client.load(apiClient, {
          preferWebgpu: offlineWebgpuPreferredRef.current,
          sampleRateHz: DEFAULT_SAMPLE_RATE,
        });

        let smartTurnLoadPromise: Promise<void> = Promise.resolve();
        if (mode === "voice" && !reuseSmartTurnWorker) {
          const smartTurnModelUrl = toAbsoluteBrowserUrl(SMART_TURN_MODEL_URL);
          const smartTurnOrtWasmBaseUrl = toAbsoluteBrowserUrl(
            VAD_ONNX_WASM_BASE_PATH,
          );
          debugStore?.setSmartTurnStatus("loading");
          debugStore?.pushSmartTurnEvent({
            type: "worker_load_start",
            turnId,
            jobId: null,
            provider: "parakeet",
            createdAtMs: Date.now(),
            details: smartTurnModelUrl,
          });
          logger.info("SmartTurnWorker", "Loading smart-turn worker runtime", {
            provider: "parakeet",
            mode,
            turnId,
            modelUrl: smartTurnModelUrl,
            ortWasmBaseUrl: smartTurnOrtWasmBaseUrl,
          });

          smartTurnLoadPromise = loadSmartTurnWorker({
            modelUrl: smartTurnModelUrl,
            ortWasmBaseUrl: smartTurnOrtWasmBaseUrl,
          })
            .then(() => {
              if (!isCurrentOfflineStart()) {
                logger.info(
                  "SmartTurnWorker",
                  "Ignored stale smart-turn worker load result",
                  {
                    provider: "parakeet",
                    mode,
                    turnId,
                    sessionId,
                  },
                );
                return;
              }
              smartTurnWorkerReadyRef.current = true;
              debugStore?.setSmartTurnError(null);
              debugStore?.setSmartTurnStatus("ready");
              debugStore?.pushSmartTurnEvent({
                type: "worker_ready",
                turnId,
                jobId: null,
                provider: "parakeet",
                createdAtMs: Date.now(),
                details: null,
              });
              logger.info(
                "SmartTurnWorker",
                "Smart-turn worker runtime ready",
                {
                  provider: "parakeet",
                  mode,
                  turnId,
                },
              );
            })
            .catch((err) => {
              if (!isCurrentOfflineStart()) {
                logger.info(
                  "SmartTurnWorker",
                  "Ignored stale smart-turn worker load failure",
                  {
                    provider: "parakeet",
                    mode,
                    turnId,
                    sessionId,
                    error: err instanceof Error ? err.message : String(err),
                  },
                );
                return;
              }

              smartTurnWorkerReadyRef.current = false;
              const errorMessage =
                err instanceof Error
                  ? err.message
                  : "Smart-turn worker initialization failed";
              debugStore?.setSmartTurnError(errorMessage);
              debugStore?.setSmartTurnStatus("error");
              debugStore?.pushSmartTurnEvent({
                type: "worker_error",
                turnId,
                jobId: null,
                provider: "parakeet",
                createdAtMs: Date.now(),
                details: errorMessage,
              });
              logger.error(
                "SmartTurnWorker",
                "Smart-turn worker initialization failed",
                err,
              );
              throw err instanceof Error ? err : new Error(errorMessage);
            });
        }

        const [loadResult] = await Promise.all([
          offlineLoadPromise,
          smartTurnLoadPromise,
        ]);

        if (!isCurrentOfflineStart()) {
          if (!canReuseTurnState && runIdRef.current === runId) {
            setRunId(null);
          }
          if (!canReuseTurnState && turnIdRef.current === turnId) {
            turnIdRef.current = null;
            gateStateRef.current = null;
          }
          if (activeOfflineSessionIdRef.current === null) {
            setIsDictationPreparing(false);
          }
          logger.info("OfflineSTT", "Offline start superseded after load", {
            runId,
            turnId,
            sessionId,
            mode,
          });
          return;
        }

        logger.info("OfflineSTT", "Offline speech runtime ready", {
          engine: route.engine,
          language: route.language,
          runId,
          turnId,
          sessionId,
          mode,
          loadMs: loadResult.loadMs,
          reused: loadResult.reused,
        });

        if (mode === "voice") {
          if (reuseSmartTurnWorker) {
            debugStore?.setSmartTurnError(null);
            debugStore?.setSmartTurnStatus("ready");
            logger.info("SmartTurnWorker", "Reused smart-turn worker runtime", {
              provider: "parakeet",
              mode,
              turnId,
            });
          }
        } else {
          debugStore?.setSmartTurnEnabled(false);
          debugStore?.setSmartTurnStatus("idle");
        }

        if (activeOfflineSessionIdRef.current !== sessionId) {
          if (!canReuseTurnState && runIdRef.current === runId) {
            setRunId(null);
          }
          if (!canReuseTurnState && turnIdRef.current === turnId) {
            turnIdRef.current = null;
            gateStateRef.current = null;
          }
          if (activeOfflineSessionIdRef.current === null) {
            setIsDictationPreparing(false);
          }
          logger.info(
            "OfflineSTT",
            "Offline start superseded after smart-turn load",
            {
              runId,
              turnId,
              sessionId,
              mode,
            },
          );
          return;
        }

        const { createAndStartMicVad, createMicVadCallbacks } =
          await import("@/hooks/voice/mic-vad-runtime");
        const previewController = createOfflinePreviewSession({
          sessionId,
          route,
          runId,
          mode,
          backend: loadResult.backend,
        });
        const micVadCallbacks = createMicVadCallbacks({
          provider: "parakeet",
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
          onVadFrame: (frame) => previewController?.pushFrame(frame),
          onSpeechWindowStarted: ({ turnId: speechTurnId, windowId }) =>
            previewController?.startWindow({ turnId: speechTurnId, windowId }),
          onSpeechWindowResolved: () => {
            void submitPendingVoiceEndTurn("speech_window_update");
          },
          onSpeechWindowInvalidated: ({ windowId }) => {
            previewController?.endWindow(windowId);
            clearOfflinePreview({ windowId, mode });
          },
          onAcceptedSpeechEnd: ({ audio, turnId: speechTurnId, windowId }) => {
            // The final decode below replaces this window's preview when it lands.
            previewController?.endWindow(windowId);
            const currentTurnId = turnIdRef.current;
            if (
              activeOfflineSessionIdRef.current !== sessionId ||
              modeRef.current !== mode ||
              runIdRef.current !== runId ||
              !currentTurnId ||
              speechTurnId !== currentTurnId
            ) {
              return;
            }
            const thresholdOverride = takePendingFlushSmartTurnOverride(
              "parakeet",
              speechTurnId,
            );
            void offlineTranscriptionsRef.current.track(
              transcribeOfflineSpeechWindow({
                sessionId,
                route,
                runId,
                turnId: speechTurnId,
                windowId,
                mode,
                audio,
                thresholdOverride,
              }),
            );
          },
          runSmartTurnSemanticCheck,
          lateFinalTranscriptGraceMs: LATE_FINAL_TRANSCRIPT_GRACE_MS,
          smartTurnSampleRate: SMART_TURN_SAMPLE_RATE,
          vadFrameDebugIntervalMs: VAD_FRAME_DEBUG_INTERVAL_MS,
        });
        const vad = await createAndStartMicVad({
          baseAssetPath: VAD_BASE_ASSET_PATH,
          onnxWasmBasePath: VAD_ONNX_WASM_BASE_PATH,
          ...micVadThresholdsRef.current,
          redemptionMs: MICVAD_REDEMPTION_MS,
          preSpeechPadMs: MICVAD_PRESPEECH_PAD_MS,
          // Only override vad-web's own stream when a device was chosen
          // (offline engines; browser recognition cannot target a device).
          ...(readSelectedMicrophoneId()
            ? { getStream: openSelectedMicrophone }
            : {}),
          ...micVadCallbacks,
        });

        if (activeOfflineSessionIdRef.current !== sessionId) {
          await vad.pause().catch(() => undefined);
          await vad.destroy().catch(() => undefined);
          if (!canReuseTurnState && runIdRef.current === runId) {
            setRunId(null);
          }
          if (!canReuseTurnState && turnIdRef.current === turnId) {
            turnIdRef.current = null;
            gateStateRef.current = null;
          }
          if (activeOfflineSessionIdRef.current === null) {
            setIsDictationPreparing(false);
          }
          return;
        }

        vadRef.current = vad;
        debugStore?.setStatus("running");
        setIsDictationPreparing(false);
        setSessionState({
          mode,
          captureActive: true,
          voiceMuted: false,
        });
        void startOfflineVisualizerStream(sessionId);
        logger.info("State", "Offline speech recognition started", {
          runId,
          turnId,
          sessionId,
          mode,
        });
      } catch (err) {
        const errorObj =
          err instanceof Error
            ? err
            : new WordedError(dictationErrorText("offlineSpeechFailed"));
        if (activeOfflineSessionIdRef.current !== sessionId) {
          if (!canReuseTurnState && runIdRef.current === runId) {
            setRunId(null);
          }
          if (!canReuseTurnState && turnIdRef.current === turnId) {
            turnIdRef.current = null;
            gateStateRef.current = null;
          }
          if (activeOfflineSessionIdRef.current === null) {
            setIsDictationPreparing(false);
          }
          logger.info("OfflineSTT", "Ignored stale offline start failure", {
            runId,
            turnId,
            sessionId,
            mode,
            error: errorObj.message,
          });
          return;
        }
        if (canReuseTurnState) {
          activeOfflineSessionIdRef.current = null;
          setIsDictationPreparing(false);
          setSessionState({
            mode: "voice",
            captureActive: false,
            voiceMuted: true,
          });
          teardownBrowserVisualizerStream();
          await suspendVadCapture("resume-offline-start-failure");
          getVoiceDebugSink()?.setError(errorObj.message);
          logger.error("State", "Offline voice resume failed", errorObj);
          throw errorObj;
        }
        activeOfflineSessionIdRef.current = null;
        setIsDictationPreparing(false);
        setSessionState({
          mode: null,
          captureActive: false,
          voiceMuted: false,
        });
        setRunId(null);
        activeProviderRef.current = null;
        teardownBrowserVisualizerStream();
        await teardownVad("parakeet-start-failure");
        await teardownSmartTurn("parakeet-start-failure");
        getVoiceDebugSink()?.setError(errorObj.message);
        logger.error(
          "State",
          "Offline speech recognition start failed",
          errorObj,
        );
        throw errorObj;
      }
    },
    [
      apiClient,
      armVoiceSilenceResetTimer,
      clearOfflinePreview,
      clearTranscriptPreview,
      clearVoiceSilenceResetTimer,
      createOfflinePreviewSession,
      logger,
      runSmartTurnSemanticCheck,
      setAvatarPhaseFromVad,
      setSessionState,
      setRunId,
      startOfflineVisualizerStream,
      submitPendingVoiceEndTurn,
      suspendVadCapture,
      syncGateDebugStats,
      takePendingFlushSmartTurnOverride,
      teardownBrowserVisualizerStream,
      teardownSmartTurn,
      teardownVad,
      transcribeOfflineSpeechWindow,
    ],
  );

  const startBrowserVisualizerStream = useCallback(
    async (
      recognition: BrowserSpeechRecognition,
      provider: BrowserSttProvider,
    ) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        return;
      }
      try {
        const visualizerStream = await navigator.mediaDevices.getUserMedia({
          // Browser speech recognition always listens on the system default
          // microphone, so its visualizer and VAD must use the same input.
          audio: microphoneAudioConstraints(null),
        });

        const isStillCurrentRecognition =
          recognitionRef.current === recognition;
        const isStillCurrentProvider = activeProviderRef.current === provider;
        const stopRequested = speechStopRequestedRef.current;
        if (
          !isStillCurrentRecognition ||
          !isStillCurrentProvider ||
          stopRequested
        ) {
          for (const track of visualizerStream.getTracks()) {
            track.stop();
          }
          return;
        }

        teardownBrowserVisualizerStream();
        browserVisualizerStreamRef.current = visualizerStream;
        setStream(visualizerStream);
      } catch (err) {
        logger.warn("BrowserSTT", "Visualizer stream unavailable", {
          provider,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [logger, setStream, teardownBrowserVisualizerStream],
  );

  const startBrowserDictation = useCallback(
    async (
      provider: BrowserSttProvider,
      mode: DictationMode,
      options?: {
        reuseTurnState?: boolean;
        reuseSmartTurnWorker?: boolean;
      },
    ) => {
      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (!SpeechRecognition) {
        throw new WordedError(dictationErrorText("webSpeechUnsupported"));
      }
      if (
        provider === "browser_local" &&
        !supportsLocalWebSpeechStrict(platform)
      ) {
        throw new WordedError(dictationErrorText("localWebSpeechUnsupported"));
      }

      const canReuseTurnState =
        options?.reuseTurnState === true &&
        Boolean(
          turnIdRef.current &&
          gateStateRef.current &&
          browserSpeechTextBuffersRef.current,
        );
      const reuseSmartTurnWorker =
        canReuseTurnState &&
        mode === "voice" &&
        options?.reuseSmartTurnWorker === true &&
        smartTurnWorkerReadyRef.current;
      const debugStore = getVoiceDebugSink();

      modeRef.current = mode;
      clearVoiceSilenceResetTimer();
      clearBrowserStopReason();
      teardownBrowserVisualizerStream();
      if (canReuseTurnState) {
        clearBrowserInterimPreview({
          reason: "voice_capture_resume",
          turnId: turnIdRef.current,
          provider,
          mode,
        });
        await suspendVadCapture("resume-browser");
      } else {
        clearTranscriptPreview({
          provider,
          mode,
          turnId: null,
        });
        lastAcceptedSpeechAtRef.current = null;
        await teardownVad("start-browser");
        await teardownSmartTurn("start-browser");
        setRunId(null);

        const turnId = createTurnId();
        turnIdRef.current = turnId;
        gateStateRef.current = startAcousticTurn(turnId);
        browserSpeechTextBuffersRef.current =
          createBrowserSpeechTextBuffers(turnId);
        lastClosedRealSpeechWindowRef.current = null;
        smartTurnAudioRef.current = new Float32Array(0);
        smartTurnActiveJobRef.current = null;
        smartTurnJobCounterRef.current = 0;
        syncGateDebugStats();
        debugStore?.startSession({
          provider,
          turnId,
        });
      }

      const turnId = turnIdRef.current;
      if (!turnId) {
        throw new Error("Missing browser turn state");
      }

      debugStore?.setTurnContext({ provider, turnId });
      debugStore?.setSmartTurnEnabled(mode === "voice");
      debugStore?.setStatus("initializing");
      debugStore?.setSmartTurnStatus(
        mode === "voice"
          ? reuseSmartTurnWorker
            ? "ready"
            : "loading"
          : "idle",
      );
      syncGateDebugStats();
      logger.info("VADInit", "Initializing acoustic VAD", {
        provider,
        turnId,
        model: "v5",
        processorType: "AudioWorklet",
        mode,
      });

      if (
        typeof window === "undefined" ||
        typeof AudioWorkletNode !== "function"
      ) {
        const errorMessage = dictationErrorText("audioWorkletVad");
        debugStore?.setError(errorMessage);
        debugStore?.setStatus("error");
        throw new WordedError(errorMessage);
      }

      try {
        // See https://docs.vad.ricky0123.com/user-guide/algorithm/ for silero vad algorithm
        // See https://docs.vad.ricky0123.com/user-guide/api/ for MicVad API reference
        const { createAndStartMicVad, createMicVadCallbacks } =
          await import("@/hooks/voice/mic-vad-runtime");

        const micVadCallbacks = createMicVadCallbacks({
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
          onSpeechWindowInvalidated: ({
            reason,
            turnId: invalidatedTurnId,
            provider: invalidatedProvider,
            windowId,
          }) => {
            clearBrowserInterimPreview({
              reason: `${reason}${windowId ? `:${windowId}` : ""}`,
              turnId: invalidatedTurnId,
              provider: invalidatedProvider,
              mode: modeRef.current,
            });
          },
          onSpeechWindowResolved: () => {
            void submitPendingVoiceEndTurn("speech_window_update");
          },
          runSmartTurnSemanticCheck,
          lateFinalTranscriptGraceMs: LATE_FINAL_TRANSCRIPT_GRACE_MS,
          smartTurnSampleRate: SMART_TURN_SAMPLE_RATE,
          vadFrameDebugIntervalMs: VAD_FRAME_DEBUG_INTERVAL_MS,
        });
        const vad = await createAndStartMicVad({
          baseAssetPath: VAD_BASE_ASSET_PATH,
          onnxWasmBasePath: VAD_ONNX_WASM_BASE_PATH,
          ...micVadThresholdsRef.current,
          redemptionMs: MICVAD_REDEMPTION_MS,
          preSpeechPadMs: MICVAD_PRESPEECH_PAD_MS,
          ...micVadCallbacks,
        });
        vadRef.current = vad;
        debugStore?.setStatus("running");
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Acoustic VAD initialization failed";
        debugStore?.setError(errorMessage);
        debugStore?.setStatus("error");
        logger.error("VADInit", "Acoustic VAD init failed", err);
        if (canReuseTurnState) {
          setSessionState({
            mode: "voice",
            captureActive: false,
            voiceMuted: true,
          });
          await suspendVadCapture("resume-init-failure");
        } else {
          await teardownVad("init-failure");
        }
        throw err instanceof Error ? err : new Error(errorMessage);
      }

      if (mode === "voice") {
        if (reuseSmartTurnWorker) {
          debugStore?.setSmartTurnError(null);
          debugStore?.setSmartTurnStatus("ready");
          logger.info("SmartTurnWorker", "Reused smart-turn worker runtime", {
            provider,
            mode,
            turnId,
          });
        } else {
          const smartTurnModelUrl = toAbsoluteBrowserUrl(SMART_TURN_MODEL_URL);
          const smartTurnOrtWasmBaseUrl = toAbsoluteBrowserUrl(
            VAD_ONNX_WASM_BASE_PATH,
          );
          debugStore?.setSmartTurnStatus("loading");
          debugStore?.pushSmartTurnEvent({
            type: "worker_load_start",
            turnId,
            jobId: null,
            provider,
            createdAtMs: Date.now(),
            details: smartTurnModelUrl,
          });
          logger.info("SmartTurnWorker", "Loading smart-turn worker runtime", {
            provider,
            mode,
            turnId,
            modelUrl: smartTurnModelUrl,
            ortWasmBaseUrl: smartTurnOrtWasmBaseUrl,
          });
          try {
            await loadSmartTurnWorker({
              modelUrl: smartTurnModelUrl,
              ortWasmBaseUrl: smartTurnOrtWasmBaseUrl,
            });
            smartTurnWorkerReadyRef.current = true;
            debugStore?.setSmartTurnError(null);
            debugStore?.setSmartTurnStatus("ready");
            debugStore?.pushSmartTurnEvent({
              type: "worker_ready",
              turnId,
              jobId: null,
              provider,
              createdAtMs: Date.now(),
              details: null,
            });
            logger.info("SmartTurnWorker", "Smart-turn worker runtime ready", {
              provider,
              mode,
              turnId,
            });
          } catch (err) {
            smartTurnWorkerReadyRef.current = false;
            const errorMessage =
              err instanceof Error
                ? err.message
                : "Smart-turn worker initialization failed";
            debugStore?.setSmartTurnError(errorMessage);
            debugStore?.setSmartTurnStatus("error");
            debugStore?.pushSmartTurnEvent({
              type: "worker_error",
              turnId,
              jobId: null,
              provider,
              createdAtMs: Date.now(),
              details: errorMessage,
            });
            logger.error(
              "SmartTurnWorker",
              "Smart-turn worker initialization failed",
              err,
            );
            if (canReuseTurnState) {
              setSessionState({
                mode: "voice",
                captureActive: false,
                voiceMuted: true,
              });
              await suspendVadCapture("resume-smart-turn-init-failure");
            } else {
              await teardownVad("smart-turn-init-failure");
              await teardownSmartTurn("smart-turn-init-failure");
            }
            throw err instanceof Error ? err : new Error(errorMessage);
          }
        }
      } else {
        debugStore?.resetSmartTurn();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      // Animas speak the app's language; under English, keep the browser's.
      recognition.lang =
        browserSpeechLanguage() ?? (navigator.language || "en-US");

      if (provider === "browser_local") {
        try {
          recognition.processLocally = true;
        } catch {
          throw new WordedError(dictationErrorText("localWebSpeechNotEnabled"));
        }

        const preferredLang = recognition.lang || "en-US";

        logger.info("BrowserSTT", "Local speech preflight", {
          provider,
          preferredLang,
        });
      }

      speechStopRequestedRef.current = false;
      recognitionRef.current = recognition;

      configureBrowserRecognitionLifecycle({
        recognition,
        provider,
        logger,
        toErrorMessage: toBrowserSttErrorMessage,
        onResult: (event) => {
          const result = processBrowserRecognitionResult({
            event,
            provider,
            fallbackTurnId: turnId,
            logger,
            mode: modeRef.current,
            currentTurnId: turnIdRef.current,
            gateState: gateStateRef.current,
            browserSpeechTextBuffers: browserSpeechTextBuffersRef.current,
            lateFinalTranscriptGraceMs: LATE_FINAL_TRANSCRIPT_GRACE_MS,
            resolveLateFinalWindow,
            pushGateDecision: (decision) => {
              debugStore?.pushGateDecision(decision);
            },
            onCommittedSegment: ({ text, turnId: segmentTurnId }) => {
              onSegmentRef.current?.({
                text,
                isFinal: true,
                runId: null,
                turnId: segmentTurnId,
                source: "browser_web_speech",
              });
            },
            syncGateDebugStats,
          });
          gateStateRef.current = result.nextGateState;
          browserSpeechTextBuffersRef.current = result.nextBuffers;
          // A waiting end of turn reads the stored transcript, so check it
          // only after this result is stored.
          if (modeRef.current === "voice") {
            void submitPendingVoiceEndTurn("transcript_update");
          }

          const currentTurnId = turnIdRef.current;
          const nextBuffers = result.nextBuffers;
          if (
            nextBuffers &&
            currentTurnId &&
            nextBuffers.turnId === currentTurnId
          ) {
            publishTranscriptPreview({
              provider,
              mode: modeRef.current,
              turnId: currentTurnId,
              finalText: nextBuffers.finalText,
              interimText: nextBuffers.interimText,
            });
          } else {
            clearTranscriptPreview({
              provider,
              mode: modeRef.current,
              turnId: currentTurnId,
            });
          }
        },
        onError: (err) => {
          setError(err);
          onErrorRef.current?.(err);
        },
        isStopRequested: () => speechStopRequestedRef.current,
        setStopRequested: (value) => {
          speechStopRequestedRef.current = value;
        },
        getStopReason: () => browserRecognitionStopReasonRef.current,
        setStopReason: (reason) => {
          browserRecognitionStopReasonRef.current = reason;
        },
        onEnded: ({ requestedStop, stopReason }) => {
          clearBrowserRecognitionHandlers(recognition);
          teardownBrowserVisualizerStream();

          if (stopReason === "pause") {
            setSessionState({
              mode: "voice",
              captureActive: false,
              voiceMuted: true,
            });
            logger.info("BrowserSTT", "Browser voice capture paused", {
              provider,
              requestedStop,
            });
            return;
          }

          if (requestedStop) {
            logger.info("BrowserSTT", "Browser dictation stopped by request", {
              provider,
              requestedStop,
              stopReason,
            });
            return;
          }

          clearTranscriptPreview({
            provider,
            mode: modeRef.current,
            turnId: turnIdRef.current,
          });
          void teardownVad("browser-onend");
          void teardownSmartTurn("browser-onend");
          setSessionState({
            mode: null,
            captureActive: false,
            voiceMuted: false,
          });
          activeProviderRef.current = null;
          modeRef.current = "dictation";
          logger.info("BrowserSTT", "Browser dictation ended", {
            provider,
            requestedStop,
            stopReason,
          });
        },
      });

      try {
        recognition.start();
      } catch (err) {
        teardownBrowserVisualizerStream();
        clearBrowserRecognitionHandlers(recognition);
        if (canReuseTurnState) {
          setSessionState({
            mode: "voice",
            captureActive: false,
            voiceMuted: true,
          });
          await suspendVadCapture("resume-browser-start-failed");
        } else {
          await teardownVad("browser-start-failed");
          await teardownSmartTurn("browser-start-failed");
        }
        throw err instanceof Error
          ? err
          : new WordedError(dictationErrorText("browserStartFailed"));
      }

      activeProviderRef.current = provider;
      setSessionState({
        mode,
        captureActive: true,
        voiceMuted: false,
      });
      void startBrowserVisualizerStream(recognition, provider);
    },
    [
      armVoiceSilenceResetTimer,
      clearBrowserStopReason,
      clearVoiceSilenceResetTimer,
      clearBrowserRecognitionHandlers,
      clearTranscriptPreview,
      clearBrowserInterimPreview,
      logger,
      publishTranscriptPreview,
      platform,
      resolveLateFinalWindow,
      runSmartTurnSemanticCheck,
      setSessionState,
      setRunId,
      setAvatarPhaseFromVad,
      submitPendingVoiceEndTurn,
      suspendVadCapture,
      syncGateDebugStats,
      startBrowserVisualizerStream,
      teardownBrowserVisualizerStream,
      teardownSmartTurn,
      teardownVad,
    ],
  );

  const unmuteVoiceMic = useCallback(async () => {
    if (activeModeRef.current !== "voice" || !isVoiceMicMuted) {
      return;
    }

    const provider = activeProviderRef.current;
    if (!provider) {
      return;
    }

    setError(null);
    try {
      if (provider === "parakeet") {
        await startOfflineDictation("voice", {
          reuseTurnState: true,
          reuseSmartTurnWorker: true,
        });
        return;
      }
      await startBrowserDictation(provider, "voice", {
        reuseTurnState: true,
        reuseSmartTurnWorker: true,
      });
    } catch (err) {
      const errorObj =
        err instanceof Error
          ? err
          : new WordedError(dictationErrorText("unmuteFailed"));
      setError(errorObj);
      onErrorRef.current?.(errorObj);
    }
  }, [isVoiceMicMuted, startBrowserDictation, startOfflineDictation]);

  const startDictation = useCallback(
    async (mode: DictationMode = "dictation") => {
      if (isDictatingRef.current) return;
      setError(null);
      modeRef.current = mode;

      try {
        const preferredProvider = toSttProvider(
          effectivePreferences.speech?.stt_provider,
        );

        const capabilities = await fetchRuntimeCapabilities(apiClient);
        // The owner's engine, else the conversation language's, read at
        // this start.
        const route = routeOfflineSpeech(undefined, savedOfflineSttEngine);
        const resolved = resolveRoutedSttProvider({
          savedProvider: preferredProvider,
          platform,
          route,
          capabilities,
        });
        if (
          resolved.languageMissing ||
          (resolved.provider === "parakeet" && !resolved.parakeetAvailable)
        ) {
          throw new WordedError(
            dictationErrorText(
              // SenseVoice chosen under English is missing a model, not a
              // language.
              route.engine === "parakeet" || route.language === "auto"
                ? "offlineSpeechMissing"
                : "languageSpeechMissing",
            ),
          );
        }
        if (resolved.provider === "parakeet") offlineRouteRef.current = route;
        if (mode === "voice") {
          if (resolved.provider === "parakeet") {
            logger.info("SmartTurnMode", "Starting offline voice mode", {
              provider: "parakeet",
              engine: route.engine,
              language: route.language,
              preferredProvider,
              hasExplicitPreference: resolved.hasExplicitPreference,
            });
            await startOfflineDictation("voice");
            return;
          }

          const provider = resolved.provider;
          logger.info("SmartTurnMode", "Starting voice mode", {
            provider,
            preferredProvider,
            hasExplicitPreference: resolved.hasExplicitPreference,
          });
          await startBrowserDictation(provider, "voice");
          return;
        }

        if (resolved.provider === "parakeet") {
          await startOfflineDictation();
          return;
        }

        await startBrowserDictation(resolved.provider, "dictation");
      } catch (err) {
        const errorObj =
          err instanceof Error
            ? err
            : new WordedError(dictationErrorText("failed"));
        setError(errorObj);
        onErrorRef.current?.(errorObj);
        setSessionState({
          mode: null,
          captureActive: false,
          voiceMuted: false,
        });
        setIsDictationPreparing(false);
        setRunId(null);
        activeProviderRef.current = null;
        activeOfflineSessionIdRef.current = null;
        modeRef.current = "dictation";
        clearBrowserStopReason();
        clearTranscriptPreview({
          mode: "dictation",
          provider: null,
          turnId: null,
        });
        teardownBrowserVisualizerStream();
        await teardownVad("dictation-start-failure");
        await teardownSmartTurn("dictation-start-failure");
        logger.error("State", "Dictation start failed", errorObj);
      }
    },
    [
      apiClient,
      effectivePreferences.speech?.stt_provider,
      savedOfflineSttEngine,
      clearBrowserStopReason,
      clearTranscriptPreview,
      logger,
      platform,
      setSessionState,
      setRunId,
      startBrowserDictation,
      startOfflineDictation,
      teardownBrowserVisualizerStream,
      teardownSmartTurn,
      teardownVad,
    ],
  );

  const switchMode = useCallback(
    async (nextMode: DictationMode) => {
      const currentMode = activeModeRef.current;
      if (!currentMode) {
        await startDictation(nextMode);
        return;
      }
      if (currentMode === nextMode) {
        return;
      }
      await stopDictation({ finishSpokenText: false });
      await startDictation(nextMode);
    },
    [startDictation, stopDictation],
  );

  useEffect(() => {
    return () => {
      void stopDictation({ finishSpokenText: false });
    };
  }, [stopDictation]);

  return {
    isDictating,
    activeMode,
    isMicCaptureActive,
    isDictationPreparing,
    isVoiceMicMuted,
    error,
    runId: runIdRef.current,
    stream,
    startDictation,
    stopDictation,
    muteVoiceMic,
    unmuteVoiceMic,
    switchMode,
  };
}
