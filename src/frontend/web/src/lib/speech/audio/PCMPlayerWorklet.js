import { EventEmitter } from "../pocket/core/EventEmitter.js";

const DEFAULT_GAIN = 2;
const MAX_GAIN = 4;

function clampGain(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_GAIN;
  }
  return Math.max(0, Math.min(MAX_GAIN, numeric));
}

/**
 * Main-thread wrapper around the pcm-processor AudioWorklet.
 * The processor owns the ring buffer; this class handles backpressure and queueing.
 */
export class PCMPlayerWorklet extends EventEmitter {
  constructor(audioContext, options = {}) {
    super();
    this.audioContext = audioContext;
    this.options = options;

    this.workletNode = null;
    this.isInitialized = false;
    this.isWorkletReady = false;
    this.hasReceivedInitialCapacity = false;

    this.pendingChunks = [];
    this.pendingStreamEnd = false;
    this.availableCapacity = 0;

    this.playbackTime = 0;

    this.metrics = {
      chunksPlayed: 0,
      underruns: 0,
      bufferLevel: 0,
      samplesPlayed: 0,
    };

    this.gainNode = this.audioContext.createGain();
    this.targetGain = clampGain(options.volume);
    this.resetGainRestoreTimeoutId = null;
    this.gainNode.gain.value = this.targetGain;
    this.gainNode.connect(this.audioContext.destination);

    this.analyser = this.audioContext.createAnalyser();
    this.gainNode.connect(this.analyser);

    this.initPromise = this.initialize();
  }

  async initialize() {
    if (this.isInitialized) return;

    const sampleRate = this.audioContext.sampleRate;
    const minBufferMs = this.options.minBufferBeforePlaybackMs || 300;
    const bufferSizeSamples = this.options.bufferSizeSamples || sampleRate * 60;
    const workletModuleUrl =
      this.options.workletModuleUrl || "/tts/audio/pcm-processor.worklet.js";

    await this.audioContext.audioWorklet.addModule(workletModuleUrl);

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          minBufferBeforePlaybackMs: minBufferMs,
          bufferSizeSamples,
        },
      },
    );
    this.workletNode.connect(this.gainNode);

    this.workletNode.port.onmessage = (e) => {
      switch (e.data.type) {
        case "capacity":
          this.handleCapacityUpdate(e.data);
          break;
        case "underrun":
          this.metrics.underruns += 1;
          this.processPendingChunks();
          break;
        case "playback-started":
          this.emit("firstPlayback", {
            startTime: this.audioContext.currentTime,
            bufferedSamples: e.data.buffered,
          });
          break;
        case "playback-complete":
          this.emit("audioEnded", {
            endTime: this.audioContext.currentTime,
          });
          break;
        default:
          break;
      }
    };

    this.isInitialized = true;
    this.isWorkletReady = true;
  }

  handleCapacityUpdate(data) {
    this.availableCapacity = data.capacity;
    this.metrics.bufferLevel = data.buffered;

    if (!this.hasReceivedInitialCapacity) {
      this.hasReceivedInitialCapacity = true;
      if (this.pendingChunks.length > 0) {
        this.processPendingChunks();
      }
    }

    if (data.requestSamples > 0 && this.pendingChunks.length > 0) {
      this.processPendingChunks();
    }
  }

  processPendingChunks() {
    if (!this.isWorkletReady || this.pendingChunks.length === 0) return;
    if (this.availableCapacity <= 0) return;

    const chunk = this.pendingChunks[0];

    if (chunk.length <= this.availableCapacity) {
      this.pendingChunks.shift();
      this.workletNode.port.postMessage({ type: "audio", data: chunk });
      this.availableCapacity = 0;
    } else if (this.availableCapacity > 4096) {
      const partial = chunk.slice(0, this.availableCapacity);
      this.pendingChunks[0] = chunk.slice(this.availableCapacity);
      this.workletNode.port.postMessage({ type: "audio", data: partial });
      this.availableCapacity = 0;
    }

    if (this.pendingChunks.length === 0 && this.pendingStreamEnd) {
      this.workletNode.port.postMessage({ type: "stream-ended" });
      this.pendingStreamEnd = false;
    }
  }

  playAudio(data) {
    if (!this.isInitialized) {
      if (!this.initPendingQueue) {
        this.initPendingQueue = [];
        this.initPromise.then(() => {
          const queue = this.initPendingQueue;
          this.initPendingQueue = null;
          for (const queuedData of queue) {
            this.playAudio(queuedData);
          }
        });
      }
      this.initPendingQueue.push(data);
      return;
    }

    if (this.audioContext.state !== "running") return;

    const float32Array =
      data instanceof Int16Array ? this.pcm16ToFloat32(data) : data;
    this.pendingChunks.push(float32Array);

    if (this.hasReceivedInitialCapacity && this.availableCapacity > 0) {
      this.processPendingChunks();
    }

    this.metrics.chunksPlayed += 1;
    this.metrics.samplesPlayed += float32Array.length;
    const duration = float32Array.length / this.audioContext.sampleRate;
    this.playbackTime = this.audioContext.currentTime + duration;

    this.emit("audioStarted", {
      startTime: this.audioContext.currentTime,
      duration,
      samples: float32Array.length,
    });
  }

  notifyStreamEnded() {
    if (this.pendingChunks.length > 0) {
      this.pendingStreamEnd = true;
    } else if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "stream-ended" });
    }
  }

  pcm16ToFloat32(pcm16) {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }
    return float32;
  }

  reset() {
    this.playbackTime = 0;
    this.pendingChunks = [];
    this.pendingStreamEnd = false;
    this.availableCapacity = 0;
    this.metrics.bufferLevel = 0;
    this.metrics.samplesPlayed = 0;

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "reset" });
    }

    if (this.gainNode) {
      if (this.resetGainRestoreTimeoutId !== null) {
        clearTimeout(this.resetGainRestoreTimeoutId);
      }
      const now = this.audioContext.currentTime;
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
      this.resetGainRestoreTimeoutId = setTimeout(() => {
        this.resetGainRestoreTimeoutId = null;
        this.gainNode.gain.value = this.targetGain;
      }, 100);
    }
  }

  stopAllSources() {
    this.reset();
  }

  async resume() {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  get volume() {
    return this.targetGain;
  }

  set volume(value) {
    const clamped = clampGain(value);
    this.targetGain = clamped;
    this.gainNode.gain.value = clamped;
    this.emit("volumeChange", { volume: clamped });
  }

  get volumePercentage() {
    return this.volume * 100;
  }

  set volumePercentage(percentage) {
    this.volume = percentage / 100;
  }

  getAnalyserData() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  getTimeDomainData() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  getPlaybackStatus() {
    const bufferMs = this.metrics.bufferLevel
      ? (this.metrics.bufferLevel / this.audioContext.sampleRate) * 1000
      : 0;

    return {
      currentTime: this.audioContext.currentTime,
      scheduledTime: this.playbackTime,
      bufferedDuration: bufferMs / 1000,
      state: this.audioContext.state,
      worklet: {
        bufferLevelSamples: this.metrics.bufferLevel,
        bufferLevelMs: bufferMs,
        underruns: this.metrics.underruns,
        chunksPlayed: this.metrics.chunksPlayed,
        pendingChunks: this.pendingChunks.length,
        samplesPlayed: this.metrics.samplesPlayed,
      },
    };
  }
}
