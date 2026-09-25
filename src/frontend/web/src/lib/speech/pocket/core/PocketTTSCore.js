/* Pocket TTS integration adapted for Animama by Raymond Van.
 * Includes third-party material under Apache-2.0; local additions retain the
 * repository license. Source and modification record:
 * licenses/third-party/code-and-models.md (repository root).
 */
import { EventEmitter } from "./EventEmitter.js";
import { PCMPlayerWorklet } from "../audio/PCMPlayerWorklet.js";
import { PocketTTSDebugTracker } from "./PocketTTSDebugTracker.js";
import { clampPocketGain } from "../audio/volume.js";
import { createLogger } from "@/lib/logger";

const DEFAULT_SAMPLE_RATE = 24000;
const FADE_SAMPLES = 480;
const REALTIME_THRESHOLD = 1.0;
const workerLogger = createLogger("PocketTTSWorker");

function createId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function isAbsoluteUrl(value) {
  return /^(https?:\/\/|\/)/.test(value);
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveAssetUrl(baseUrl, relativePath) {
  if (isAbsoluteUrl(relativePath)) {
    return relativePath;
  }
  return `${trimTrailingSlash(baseUrl)}/${relativePath.replace(/^\//, "")}`;
}

export class PocketTTSCore extends EventEmitter {
  constructor(options = {}) {
    super();

    const assetBaseUrl = options.assetBaseUrl || "/tts";

    this.options = {
      assetBaseUrl,
      audioSampleRate: options.audioSampleRate || DEFAULT_SAMPLE_RATE,
      playbackStrategy: options.playbackStrategy || "adaptive",
      enableVoiceCloning: options.enableVoiceCloning !== false,
      defaultVoice: options.defaultVoice || null,
      maxVoiceSeconds: options.maxVoiceSeconds || 10,
      onEvent: typeof options.onEvent === "function" ? options.onEvent : null,
      workerUrl:
        options.workerUrl ||
        resolveAssetUrl(assetBaseUrl, "workers/inference-worker.js"),
      workerName:
        options.workerName ||
        `pocket-tts-worker-${
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID().replace(/-/g, "").slice(0, 6)
            : Math.random().toString(36).slice(2, 8).padEnd(6, "0")
        }`,
      workletModuleUrl:
        options.workletModuleUrl ||
        resolveAssetUrl(assetBaseUrl, "audio/pcm-processor.worklet.js"),
      ortModuleUrl: options.ortModuleUrl || "/onnx/ort/1.24.2/ort.min.mjs",
      ortWasmBaseUrl: options.ortWasmBaseUrl || "/onnx/ort/1.24.2/",
      sentencepieceModuleUrl:
        options.sentencepieceModuleUrl ||
        resolveAssetUrl(assetBaseUrl, "vendor/sentencepiece.js"),
    };

    this.worker = null;
    this.player = null;
    this.audioContext = null;

    this.phase = "idle";
    this.isInitialized = false;
    this.isWorkerReady = false;
    this.isGenerating = false;

    this.availableVoices = [];
    this.currentVoice = this.options.defaultVoice;
    this.volume = clampPocketGain(options.volume);

    this.activeGenerationId = null;
    this.deferredGenerationId = null;
    this.pendingPlaybackEndedGenerationId = null;
    this.activeGenerationOptions = null;

    this.generationStartTime = 0;
    this.lastChunkFinishTime = 0;
    this.rtfMovingAverage = 0;
    this.skipNextRtf = false;

    this.edgeOptimizationApplied = false;
    this.playbackMode = "pending";
    this.bufferedChunks = [];
    this.deferStreamEnd = false;

    this.metrics = {
      ttfbMs: null,
      rtfx: null,
      rtfEma: 0,
      edgeOptimizationApplied: false,
      underruns: 0,
      bufferLevelMs: 0,
    };

    this.pendingRequests = new Map();

    this._debugTracker = new PocketTTSDebugTracker({
      workerName: this.options.workerName,
      emitEvent: (eventName, detail) => this._emitEvent(eventName, detail),
      hasWorker: () => Boolean(this.worker),
      getPendingRequestCount: () => this.pendingRequests.size,
    });
  }

  async init() {
    if (this.isInitialized && this.isWorkerReady) {
      return;
    }

    this._setPhase("loading");

    if (!window.isSecureContext) {
      throw new Error(
        "Secure context is required (HTTPS or localhost) for AudioWorklet.",
      );
    }

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: this.options.audioSampleRate,
      latencyHint: "interactive",
    });

    if (!this.audioContext.audioWorklet) {
      throw new Error("AudioWorklet is not supported by this browser.");
    }

    this.player = new PCMPlayerWorklet(this.audioContext, {
      workletModuleUrl: this.options.workletModuleUrl,
      minBufferBeforePlaybackMs: 300,
      bufferSizeSamples: this.options.audioSampleRate * 60,
    });
    await this.player.initPromise;
    this.player.volume = this.volume;

    // Anchor playback_started to the worklet's real playback begin signal
    // (after startup buffering), not when audio is merely queued.
    this.player.addEventListener("firstPlayback", (event) => {
      const detail = event?.detail || {};
      this._emitEvent("playback_started", {
        generationId: this.activeGenerationId,
        startTime:
          typeof detail.startTime === "number"
            ? detail.startTime
            : this.audioContext
              ? this.audioContext.currentTime
              : null,
        bufferedSamples:
          typeof detail.bufferedSamples === "number"
            ? detail.bufferedSamples
            : null,
      });
    });

    this.player.addEventListener("audioEnded", () => {
      this._emitEvent("playback_ended", {
        generationId:
          this.deferredGenerationId ||
          this.pendingPlaybackEndedGenerationId ||
          this.activeGenerationId,
      });
      this.pendingPlaybackEndedGenerationId = null;
      if (this.deferStreamEnd && this.deferredGenerationId) {
        const generationId = this.deferredGenerationId;
        this.deferStreamEnd = false;
        this.deferredGenerationId = null;
        this._finalizePlayback(generationId);
      }
    });

    this.worker = new Worker(this.options.workerUrl, {
      type: "module",
      name: this.options.workerName,
    });
    this._debugTracker.markWorkerCreated({ threadId: this.options.workerName });
    this._debugTracker.setWorkerStatus("starting");
    this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);
    this.worker.onerror = (e) => {
      this._debugTracker.setWorkerLastError(e.message || "Worker error");
      this._debugTracker.setWorkerStatus("error");
      this._setPhase("error");
      this._emitEvent("error", {
        error: e.message || "Worker error",
      });
    };

    await this._sendWorkerMessage(
      "load",
      {
        // Model URLs default to the worker's reviewed bundle layout.
        runtime: {
          ortModuleUrl: this.options.ortModuleUrl,
          ortWasmBaseUrl: this.options.ortWasmBaseUrl,
          sentencepieceModuleUrl: this.options.sentencepieceModuleUrl,
        },
      },
      { awaitResponse: true },
    );

    this.isInitialized = true;
    if (!this.isGenerating) {
      this._setPhase("ready");
    }
  }

  async destroy() {
    this.stop();

    for (const [, pending] of this.pendingRequests) {
      pending.reject(
        new Error("PocketTTSCore destroyed before response was received."),
      );
    }
    this.pendingRequests.clear();
    this._debugTracker.clearPendingRequestMeta();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.player = null;
    this.isInitialized = false;
    this.isWorkerReady = false;
    this.isGenerating = false;
    this.activeGenerationId = null;
    this.activeGenerationOptions = null;
    this._debugTracker.clearWorkerCurrentTask();
    this._debugTracker.setWorkerStatus("idle", {
      currentTaskType: null,
      currentTaskGenerationId: null,
      lastError: null,
    });
    this._setPhase("idle");
  }

  async generate(text, opts = {}) {
    await this.init();

    const cleanText = String(text || "").trim();
    if (!cleanText) {
      throw new Error("Cannot generate audio from empty text.");
    }
    if (this.isGenerating) {
      throw new Error("Generation already in progress.");
    }

    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.isGenerating = true;
    this._setPhase("generating");
    this.activeGenerationId = createId("gen");
    this.activeGenerationOptions = {
      preservePlayback: opts.preservePlayback === true,
      endStream: opts.endStream !== false,
    };

    if (this.player && !this.activeGenerationOptions.preservePlayback) {
      this.player.reset();
    }

    this._resetGenerationMetrics();

    const voice = opts.voice || this.currentVoice || this.options.defaultVoice;
    const animaId =
      typeof opts.animaId === "string" && opts.animaId.trim().length > 0
        ? opts.animaId.trim()
        : null;
    const animaVoiceKey =
      typeof opts.animaVoiceKey === "string" &&
      opts.animaVoiceKey.trim().length > 0
        ? opts.animaVoiceKey.trim()
        : null;

    this._sendWorkerMessage(
      "generate",
      {
        text: cleanText,
        voice,
        animaId,
        animaVoiceKey,
      },
      { generationId: this.activeGenerationId },
    );

    return { generationId: this.activeGenerationId };
  }

  stop() {
    if (!this.isGenerating || !this.activeGenerationId) {
      return;
    }
    this._sendWorkerMessage(
      "stop",
      {},
      { generationId: this.activeGenerationId },
    );
  }

  endPlaybackStream() {
    if (!this.player) {
      return;
    }
    this.player.notifyStreamEnded();
  }

  setVoice(voiceName) {
    this._sendWorkerMessage("set_voice", { voiceName });
  }

  setVolume(volume) {
    this.volume = clampPocketGain(volume);
    if (this.player) {
      this.player.volume = this.volume;
    }
  }

  getVolume() {
    return this.volume;
  }

  async preloadAnimaVoices(animaRef) {
    const normalizedAnimaRef = String(animaRef || "").trim();
    if (!normalizedAnimaRef) {
      return {
        available: false,
        voices: [],
      };
    }

    await this.init();
    return this._sendWorkerMessage(
      "preload_anima_voices",
      { animaId: normalizedAnimaRef },
      { awaitResponse: true },
    );
  }

  async encodeVoiceFromFloat32(audio) {
    if (!this.options.enableVoiceCloning) {
      throw new Error("Voice cloning is disabled for this core instance.");
    }
    await this.init();

    if (!(audio instanceof Float32Array)) {
      throw new Error("encodeVoiceFromFloat32 expects a Float32Array.");
    }

    const transferred = new Float32Array(audio);

    const response = await this._sendWorkerMessage(
      "encode_voice",
      { audio: transferred },
      { awaitResponse: true, transfer: [transferred.buffer] },
    );

    return { voiceName: response.voiceName || "custom" };
  }

  async encodeVoiceFromFile(file) {
    if (!file) {
      throw new Error("No audio file was provided.");
    }
    if (!this.options.enableVoiceCloning) {
      throw new Error("Voice cloning is disabled for this core instance.");
    }

    await this.init();

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    let audioData;
    if (audioBuffer.sampleRate !== this.options.audioSampleRate) {
      audioData = this._resampleAudio(
        audioBuffer,
        this.options.audioSampleRate,
      );
    } else {
      audioData = audioBuffer.getChannelData(0);
      if (audioBuffer.numberOfChannels > 1) {
        const right = audioBuffer.getChannelData(1);
        const mono = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          mono[i] = (audioData[i] + right[i]) * 0.5;
        }
        audioData = mono;
      }
    }

    const maxSamples =
      this.options.audioSampleRate * this.options.maxVoiceSeconds;
    if (audioData.length > maxSamples) {
      audioData = audioData.slice(0, maxSamples);
    }

    return this.encodeVoiceFromFloat32(audioData);
  }

  getVoices() {
    return [...this.availableVoices];
  }

  getAudioContext() {
    return this.audioContext || null;
  }

  getStatus() {
    return {
      phase: this.phase,
      playbackMode: this.playbackMode,
      generationId: this.activeGenerationId,
      currentVoice: this.currentVoice,
    };
  }

  getMetrics() {
    const playback = this.player ? this.player.getPlaybackStatus() : null;
    return {
      ttfbMs: this.metrics.ttfbMs,
      rtfx: this.metrics.rtfx,
      rtfEma: this.metrics.rtfEma,
      edgeOptimizationApplied: this.metrics.edgeOptimizationApplied,
      underruns: playback ? playback.worklet.underruns : this.metrics.underruns,
      bufferLevelMs: playback
        ? playback.worklet.bufferLevelMs
        : this.metrics.bufferLevelMs,
    };
  }

  getDebugStatus() {
    return this._debugTracker.getDebugStatus();
  }

  _setPhase(phase, extra = {}) {
    this.phase = phase;
    this._emitEvent("state_changed", {
      phase,
      playbackMode: this.playbackMode,
      generationId: this.activeGenerationId,
      ...extra,
    });
  }

  _emitEvent(eventName, detail) {
    this.emit(eventName, detail);
    if (this.options.onEvent) {
      this.options.onEvent(eventName, detail);
    }
  }

  _handleWorkerMessage(message) {
    const { type, requestId, generationId } = message;
    this._debugTracker.recordWorkerIncoming(type);

    if (type === "error") {
      this._debugTracker.recordWorkerReply(requestId, "error");
      if (requestId && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        pending.reject(new Error(message.error || "Worker error"));
      }

      this._debugTracker.setWorkerLastError(message.error || "Worker error");
      this._debugTracker.setWorkerStatus("error");
      this._setPhase("error");
      this._emitEvent("error", {
        error: message.error || "Worker error",
        generationId: generationId || this.activeGenerationId,
      });
      return;
    }

    if (
      requestId &&
      this.pendingRequests.has(requestId) &&
      [
        "ready",
        "voice_encoded",
        "voice_set",
        "anima_voices_preloaded",
      ].includes(type)
    ) {
      const pending = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      this._debugTracker.recordWorkerReply(requestId, type);
      pending.resolve(message);
    } else if (
      requestId &&
      (type === "generation_started" || type === "model_status")
    ) {
      this._debugTracker.recordWorkerReply(requestId, type);
    }

    switch (type) {
      case "state_changed": {
        if (typeof message.state === "string") {
          const phaseMap = {
            loading: "loading",
            ready: this.isGenerating ? "generating" : "ready",
            generating: "generating",
            stopped: "stopped",
          };
          const mapped = phaseMap[message.state];
          if (mapped) {
            this.phase = mapped;
            if (mapped === "stopped") {
              this._debugTracker.clearWorkerCurrentTask("generate");
            }
            if (
              mapped === "ready" &&
              this._debugTracker.getWorkerCurrentTaskType() === "load"
            ) {
              this._debugTracker.clearWorkerCurrentTask("load");
            }
            this._emitEvent("state_changed", {
              phase: mapped,
              playbackMode: this.playbackMode,
              generationId: this.activeGenerationId,
              message: message.message || null,
            });
          }
        }
        break;
      }

      case "model_status": {
        this._emitEvent("model_status", {
          status: message.status,
          text: message.text,
        });
        break;
      }

      case "ort_debug_status": {
        this._debugTracker.updateOrtRuntime(
          message.data || message.runtime || null,
        );
        break;
      }

      case "voices_loaded": {
        this.availableVoices = message.voices || [];
        this.currentVoice = message.defaultVoice || this.currentVoice;
        this._emitEvent("voices_loaded", {
          voices: this.availableVoices,
          defaultVoice: this.currentVoice,
        });
        break;
      }

      case "voice_set": {
        this.currentVoice = message.voiceName || this.currentVoice;
        break;
      }

      case "voice_encoded": {
        this.currentVoice = message.voiceName || "custom";
        this._emitEvent("voice_encoded", { voiceName: this.currentVoice });
        break;
      }

      case "ready": {
        this.isWorkerReady = true;
        this._debugTracker.clearWorkerLastError();
        this._debugTracker.clearWorkerCurrentTask("load");
        this._debugTracker.setWorkerStatus("ready");
        if (!this.isGenerating) {
          this._setPhase("ready");
        }
        break;
      }

      case "generation_started": {
        if (generationId && generationId !== this.activeGenerationId) {
          return;
        }
        this._debugTracker.clearWorkerLastError();
        if (this._debugTracker.getWorkerCurrentTaskType() !== "generate") {
          this._debugTracker.setWorkerCurrentTask(
            "generate",
            generationId || this.activeGenerationId,
          );
        }
        this._emitEvent("generation_started", {
          generationId: this.activeGenerationId,
          startedAt: performance.now(),
        });
        break;
      }

      case "audio_chunk": {
        this._handleAudioChunk(
          message.data,
          message.metrics || {},
          generationId,
        );
        break;
      }

      case "stream_ended": {
        this._debugTracker.clearWorkerCurrentTask("generate");
        this._handleStreamEnd(generationId);
        break;
      }

      case "generation_finished": {
        if (generationId && generationId !== this.activeGenerationId) {
          return;
        }

        if (message.metrics && typeof message.metrics.rtfx === "number") {
          this.metrics.rtfx = message.metrics.rtfx;
        }

        this._debugTracker.clearWorkerCurrentTask("generate");
        this._emitEvent("generation_finished", {
          generationId: generationId || this.activeGenerationId,
          metrics: message.metrics || null,
        });
        break;
      }

      case "log": {
        this._handleWorkerLog(message);
        break;
      }

      default:
        break;
    }
  }

  _handleWorkerLog(message) {
    const level =
      message.level === "debug" ||
      message.level === "warn" ||
      message.level === "error"
        ? message.level
        : "info";
    const category =
      typeof message.category === "string" && message.category.length > 0
        ? message.category
        : "Worker";
    const logMessage =
      typeof message.message === "string"
        ? message.message
        : String(message.message ?? "");
    const data = message.data;
    const threadId =
      typeof message.threadId === "string" && message.threadId.length > 0
        ? message.threadId
        : this.options.workerName;

    if (level === "error") {
      workerLogger.error(category, logMessage, data, { threadId });
      return;
    }
    if (level === "warn") {
      workerLogger.warn(category, logMessage, data, { threadId });
      return;
    }
    if (level === "debug") {
      workerLogger.debug(category, logMessage, data, { threadId });
      return;
    }
    workerLogger.info(category, logMessage, data, { threadId });
  }

  _resetGenerationMetrics() {
    this.generationStartTime = performance.now();
    this.lastChunkFinishTime = 0;
    this.rtfMovingAverage = 0;
    this.skipNextRtf = false;
    this.edgeOptimizationApplied = false;

    this.playbackMode =
      this.options.playbackStrategy === "stream"
        ? "stream"
        : this.options.playbackStrategy === "buffer_all"
          ? "buffer_all"
          : "pending";

    this.bufferedChunks = [];
    this.deferStreamEnd = false;
    this.deferredGenerationId = null;
    this.pendingPlaybackEndedGenerationId = null;

    this.metrics = {
      ttfbMs: null,
      rtfx: null,
      rtfEma: 0,
      edgeOptimizationApplied: false,
      underruns: 0,
      bufferLevelMs: 0,
    };
  }

  _applyFadeIn(audioData) {
    const fadeLen = Math.min(FADE_SAMPLES, audioData.length);
    for (let i = 0; i < fadeLen; i++) {
      audioData[i] *= i / fadeLen;
    }
  }

  _applyFadeOut(audioData) {
    const fadeLen = Math.min(FADE_SAMPLES, audioData.length);
    const startIdx = audioData.length - fadeLen;
    for (let i = 0; i < fadeLen; i++) {
      audioData[startIdx + i] *= 1 - i / fadeLen;
    }
  }

  _bufferOrPlay(audioData) {
    if (this.playbackMode === "stream") {
      this.player.playAudio(audioData);
      return;
    }
    this.bufferedChunks.push(audioData);
  }

  _flushBufferedAudio() {
    if (!this.bufferedChunks.length) {
      return;
    }

    for (const chunk of this.bufferedChunks) {
      this.player.playAudio(chunk);
    }

    this.bufferedChunks = [];
  }

  _switchToStream() {
    this.playbackMode = "stream";
    this._flushBufferedAudio();
  }

  _switchToBufferAll() {
    this.playbackMode = "buffer_all";
  }

  _finalizePlayback(generationId) {
    if (
      generationId &&
      this.activeGenerationId &&
      generationId !== this.activeGenerationId
    ) {
      return;
    }

    this.isGenerating = false;
    this.activeGenerationId = null;
    this.activeGenerationOptions = null;
    this.deferStreamEnd = false;
    this.deferredGenerationId = null;

    if (this.isWorkerReady) {
      this._setPhase("ready");
    } else {
      this._setPhase("idle");
    }
  }

  _handleAudioChunk(audioData, metrics, generationId) {
    if (!this.isGenerating) return;
    if (generationId && generationId !== this.activeGenerationId) return;

    if (!(audioData instanceof Float32Array)) {
      audioData = new Float32Array(audioData);
    }

    if (metrics.isSilence) {
      this._bufferOrPlay(audioData);
      this.skipNextRtf = true;
      return;
    }

    if (metrics.isFirst || metrics.chunkStart) this._applyFadeIn(audioData);
    if (metrics.isLast) this._applyFadeOut(audioData);

    const now = performance.now();
    let ttfb = 0;
    let instantaneousRTF = 0;
    let arrivalRTF = 0;

    if (metrics.isFirst) {
      ttfb = now - this.generationStartTime;
      this.lastChunkFinishTime = now;
      this.metrics.ttfbMs = Math.round(ttfb);
    } else if (this.skipNextRtf) {
      this.lastChunkFinishTime = now;
      this.skipNextRtf = false;
    } else if (this.lastChunkFinishTime > 0) {
      const timeSinceLastChunk = (now - this.lastChunkFinishTime) / 1000;
      this.lastChunkFinishTime = now;
      if (timeSinceLastChunk > 0) {
        arrivalRTF = metrics.chunkDuration / timeSinceLastChunk;
      }
    }

    if (metrics.genTimeSec && metrics.genTimeSec > 0) {
      instantaneousRTF = metrics.chunkDuration / metrics.genTimeSec;
    } else if (arrivalRTF > 0) {
      instantaneousRTF = arrivalRTF;
    }

    if (instantaneousRTF > 0) {
      if (this.rtfMovingAverage === 0) {
        this.rtfMovingAverage = instantaneousRTF;
      } else {
        this.rtfMovingAverage =
          this.rtfMovingAverage * 0.8 + instantaneousRTF * 0.2;
      }

      this.metrics.rtfEma = this.rtfMovingAverage;
      this.metrics.rtfx = this.rtfMovingAverage;

      const edgeRtf = arrivalRTF > 0 ? arrivalRTF : instantaneousRTF;
      if (
        this.options.playbackStrategy === "adaptive" &&
        !this.edgeOptimizationApplied &&
        edgeRtf < REALTIME_THRESHOLD
      ) {
        this.edgeOptimizationApplied = true;
        this.metrics.edgeOptimizationApplied = true;
      }
    }

    if (this.options.playbackStrategy === "adaptive") {
      if (this.playbackMode === "pending") {
        if (instantaneousRTF >= REALTIME_THRESHOLD) {
          this._switchToStream();
        } else if (
          !metrics.isFirst &&
          this.edgeOptimizationApplied &&
          instantaneousRTF < REALTIME_THRESHOLD
        ) {
          this._switchToBufferAll();
        }
      }
    } else if (
      this.options.playbackStrategy === "stream" &&
      this.playbackMode !== "stream"
    ) {
      this._switchToStream();
    }

    this._bufferOrPlay(audioData);

    const playback = this.player.getPlaybackStatus();
    this.metrics.bufferLevelMs = playback.worklet.bufferLevelMs;
    this.metrics.underruns = playback.worklet.underruns;

    this._emitEvent("audio_chunk", {
      generationId: this.activeGenerationId,
      chunkDurationSec: metrics.chunkDuration || 0,
      metrics: this.getMetrics(),
    });
  }

  _handleStreamEnd(generationId) {
    if (!this.isGenerating) return;
    if (generationId && generationId !== this.activeGenerationId) return;

    if (this.playbackMode === "pending") {
      if (this.options.playbackStrategy === "stream") {
        this._switchToStream();
      } else {
        this._switchToBufferAll();
      }
    }

    const shouldEndPlaybackStream =
      this.activeGenerationOptions?.endStream !== false;

    if (this.playbackMode === "buffer_all") {
      this._flushBufferedAudio();
      if (shouldEndPlaybackStream) {
        this.pendingPlaybackEndedGenerationId =
          generationId || this.activeGenerationId;
        this.player.notifyStreamEnded();
        this.deferStreamEnd = true;
        this.deferredGenerationId = generationId || this.activeGenerationId;
        return;
      }
      this._finalizePlayback(generationId || this.activeGenerationId);
      return;
    }

    if (shouldEndPlaybackStream) {
      this.pendingPlaybackEndedGenerationId =
        generationId || this.activeGenerationId;
      this.player.notifyStreamEnded();
    }
    this._finalizePlayback(generationId || this.activeGenerationId);
  }

  _resampleAudio(audioBuffer, targetRate) {
    const sourceRate = audioBuffer.sampleRate;
    const left = audioBuffer.getChannelData(0);

    let monoData = left;
    if (audioBuffer.numberOfChannels > 1) {
      const right = audioBuffer.getChannelData(1);
      monoData = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) {
        monoData[i] = (left[i] + right[i]) * 0.5;
      }
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.floor(monoData.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcFloor = Math.floor(srcIndex);
      const srcCeil = Math.min(srcFloor + 1, monoData.length - 1);
      const t = srcIndex - srcFloor;
      output[i] = monoData[srcFloor] * (1 - t) + monoData[srcCeil] * t;
    }

    return output;
  }

  _sendWorkerMessage(type, data = {}, opts = {}) {
    if (!this.worker) {
      throw new Error("Worker is not initialized. Call init() first.");
    }

    const requestId = opts.requestId || createId("req");
    const payload = {
      type,
      requestId,
      data,
    };

    if (opts.generationId) {
      payload.generationId = opts.generationId;
    }

    let promise = null;
    if (opts.awaitResponse) {
      promise = new Promise((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
      });
    }

    if (opts.transfer && Array.isArray(opts.transfer)) {
      this.worker.postMessage(payload, opts.transfer);
    } else {
      this.worker.postMessage(payload);
    }

    this._debugTracker.recordWorkerRequestSent(type, requestId, {
      awaitResponse: opts.awaitResponse === true,
      generationId: opts.generationId || null,
    });

    return promise || requestId;
  }
}
