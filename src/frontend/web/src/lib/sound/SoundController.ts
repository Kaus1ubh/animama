"use client";

import { createLogger } from "@/lib/logger";

import type {
  PlayBgmOptions,
  PreloadBgmOptions,
  PlaySfxOptions,
  SoundControllerSnapshot,
  SoundControllerSubscriber,
  SoundPlaybackId,
} from "./types";
import { DEFAULT_SOUND_CONTROLLER_SNAPSHOT } from "./types";
import type { AudioPrefs } from "./audio-prefs";

const logger = createLogger("SoundController");

type ActiveSfxPlayback = {
  audio: HTMLAudioElement;
  baseVolume: number;
  cleanup?: () => void;
};

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const BGM_MAX_GAIN = 0.5;

function mapNormalizedBgmVolumeToGain(value: number): number {
  return clampVolume(value) * BGM_MAX_GAIN;
}

function isAutoplayBlocked(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function canUseAudioElement(): boolean {
  return typeof Audio !== "undefined";
}

const MAX_ACTIVE_SFX = 8;

export class SoundController {
  private snapshot: SoundControllerSnapshot = {
    ...DEFAULT_SOUND_CONTROLLER_SNAPSHOT,
  };
  private readonly listeners = new Set<SoundControllerSubscriber>();
  private readonly activeSfx = new Map<SoundPlaybackId, ActiveSfxPlayback>();
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmTrackUrl: string | null = null;
  private bgmLoop = true;
  private bgmBaseVolume = 1;
  private bgmPlayPromise: Promise<boolean> | null = null;
  private bgmPlaybackAttemptId = 0;
  private isDisposed = false;

  subscribe = (listener: SoundControllerSubscriber) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  dispose() {
    if (this.isDisposed) return;
    logger.info("Lifecycle", "Disposing sound controller");
    this.isDisposed = true;
    this.stopAllSfx();
    this.teardownBgmAudio();
    this.listeners.clear();
  }

  async playBgm(options: PlayBgmOptions = {}): Promise<boolean> {
    if (this.bgmPlayPromise) {
      return this.bgmPlayPromise;
    }

    const playPromise = this.startBgmPlayback(options).finally(() => {
      if (this.bgmPlayPromise === playPromise) {
        this.bgmPlayPromise = null;
      }
    });
    this.bgmPlayPromise = playPromise;
    return playPromise;
  }

  preloadBgm(options: PreloadBgmOptions = {}) {
    const trackUrl = options.trackUrl ?? this.bgmTrackUrl;
    if (!trackUrl) return;

    const audio = this.ensureBgmAudio();
    if (!audio) return;

    this.syncBgmSource(audio, trackUrl, { load: true });
  }

  private async startBgmPlayback(options: PlayBgmOptions): Promise<boolean> {
    const trackUrl = options.trackUrl ?? this.bgmTrackUrl;
    if (!trackUrl) return false;

    const audio = this.ensureBgmAudio();
    if (!audio) return false;
    const attemptId = ++this.bgmPlaybackAttemptId;

    this.syncBgmSource(audio, trackUrl);

    if (typeof options.loop === "boolean") this.bgmLoop = options.loop;
    if (typeof options.volume === "number") {
      this.bgmBaseVolume = clampVolume(options.volume);
    }
    audio.loop = this.bgmLoop;
    this.applyBgmMix(audio);
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmState: "loading",
      pendingAutoplayRetry: false,
    }));
    logger.debug("Playback", "Calling BGM audio.play()", {
      attemptId,
      readyState: audio.readyState,
      networkState: audio.networkState,
      currentTime: audio.currentTime,
      paused: audio.paused,
      muted: audio.muted,
      volume: audio.volume,
    });

    try {
      await audio.play();
      if (this.bgmPlaybackAttemptId !== attemptId) {
        // A newer stop, pause, or play attempt owns the shared Audio element.
        // Do not let this stale completion interrupt the newer source.
        return false;
      }
      this.updateSnapshot((prev) => ({
        ...prev,
        bgmState: "playing",
        pendingAutoplayRetry: false,
      }));
      return true;
    } catch (error) {
      if (this.bgmPlaybackAttemptId !== attemptId) {
        return false;
      }
      if (isAutoplayBlocked(error)) {
        this.updateSnapshot((prev) => ({
          ...prev,
          bgmState: "blocked",
          pendingAutoplayRetry: true,
        }));
        logger.info("Playback", "BGM autoplay blocked", {
          reason: "browser_autoplay_blocked",
        });
      } else {
        this.updateSnapshot((prev) => ({
          ...prev,
          bgmState: "stopped",
          pendingAutoplayRetry: false,
        }));
        logger.warn("Playback", "BGM playback failed", {
          reason: "bgm_playback_failed",
        });
      }
      return false;
    }
  }

  pauseBgm() {
    this.bgmPlaybackAttemptId += 1;
    this.bgmPlayPromise = null;
    const audio = this.bgmAudio;
    if (audio) {
      audio.pause();
    }
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmState: "paused",
      pendingAutoplayRetry: false,
    }));
  }

  stopBgm() {
    this.bgmPlaybackAttemptId += 1;
    this.bgmPlayPromise = null;
    const audio = this.bgmAudio;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
      audio.load();
    }
    this.bgmTrackUrl = null;
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmState: "stopped",
      bgmTrackUrl: null,
      pendingAutoplayRetry: false,
    }));
  }

  retryPendingBgmAutoplay(): Promise<boolean> {
    if (this.snapshot.bgmMuted || !this.snapshot.pendingAutoplayRetry) {
      return Promise.resolve(false);
    }
    return this.playBgm();
  }

  restorePersistedState(prefs: AudioPrefs) {
    this.bgmTrackUrl = null;
    this.bgmLoop = true;
    this.bgmBaseVolume = 1;
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmState: "stopped",
      bgmTrackUrl: null,
      pendingAutoplayRetry: false,
      bgmMuted: prefs.bgmMuted,
      sfxMuted: prefs.sfxMuted,
      ttsMuted: prefs.ttsMuted,
      bgmVolume: clampVolume(prefs.bgmVolume),
      sfxVolume: clampVolume(prefs.sfxVolume),
      ttsVolume: clampVolume(prefs.ttsVolume),
    }));
    logger.info("Persistence", "Restored persisted audio preferences");

    if (prefs.sfxMuted) {
      this.stopAllSfx();
    }
    this.applyMixToActiveAudio();
  }

  playSfx(
    assetPath: string,
    options: PlaySfxOptions = {},
  ): SoundPlaybackId | null {
    if (
      this.isDisposed ||
      !assetPath ||
      options.signal?.aborted ||
      !canUseAudioElement() ||
      this.snapshot.sfxMuted ||
      this.activeSfx.size >= MAX_ACTIVE_SFX
    ) {
      if (this.activeSfx.size >= MAX_ACTIVE_SFX) {
        logger.warn("Playback", "SFX concurrency limit reached");
      }
      return null;
    }

    const playbackId = `sfx-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const audio = new Audio(assetPath);
    const playback: ActiveSfxPlayback = {
      audio,
      baseVolume: clampVolume(options.volume ?? 1),
    };

    audio.preload = "auto";
    audio.loop = options.loop === true;
    this.activeSfx.set(playbackId, playback);
    this.applySfxMix(playback);

    const cleanup = () => {
      options.signal?.removeEventListener("abort", cleanup);
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      this.activeSfx.delete(playbackId);
    };

    playback.cleanup = cleanup;
    options.signal?.addEventListener("abort", cleanup, { once: true });
    audio.onended = cleanup;
    audio.onerror = () => {
      logger.warn("Playback", "SFX playback failed", {
        reason: "sfx_playback_failed",
      });
      cleanup();
    };

    void audio.play().catch(() => {
      logger.warn("Playback", "SFX play rejected", {
        reason: "sfx_play_rejected",
      });
      cleanup();
    });

    return playbackId;
  }

  stopSfx(playbackId: SoundPlaybackId) {
    const playback = this.activeSfx.get(playbackId);
    if (!playback) return;
    playback.cleanup?.();
  }

  stopAllSfx() {
    for (const playback of this.activeSfx.values()) {
      playback.cleanup?.();
    }
    this.activeSfx.clear();
  }

  setMasterMuted(muted: boolean) {
    this.updateSnapshot((prev) => ({
      ...prev,
      masterMuted: muted,
    }));
    this.applyMixToActiveAudio();
  }

  setBgmMuted(muted: boolean) {
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmMuted: muted,
      pendingAutoplayRetry: muted ? false : prev.pendingAutoplayRetry,
    }));
    if (this.bgmAudio) {
      this.applyBgmMix(this.bgmAudio);
    }
  }

  setSfxMuted(muted: boolean) {
    this.updateSnapshot((prev) => ({
      ...prev,
      sfxMuted: muted,
    }));
    if (muted) {
      this.stopAllSfx();
      return;
    }
    for (const playback of this.activeSfx.values()) {
      this.applySfxMix(playback);
    }
    logger.info("Mix", "Updated SFX mute", { muted });
  }

  setBgmVolume(value: number) {
    const bgmVolume = clampVolume(value);
    this.updateSnapshot((prev) => ({
      ...prev,
      bgmVolume,
    }));
    if (this.bgmAudio) {
      this.applyBgmMix(this.bgmAudio);
    }
  }

  setSfxVolume(value: number) {
    const sfxVolume = clampVolume(value);
    this.updateSnapshot((prev) => ({
      ...prev,
      sfxVolume,
    }));
    for (const playback of this.activeSfx.values()) {
      this.applySfxMix(playback);
    }
  }

  setTtsVolume(value: number) {
    const ttsVolume = clampVolume(value);
    this.updateSnapshot((prev) => ({
      ...prev,
      ttsVolume,
    }));
  }

  setTtsMuted(muted: boolean) {
    this.updateSnapshot((prev) => ({
      ...prev,
      ttsMuted: muted,
    }));
  }

  hasActiveBgmPlayback() {
    return Boolean(this.bgmAudio && !this.bgmAudio.paused);
  }

  private ensureBgmAudio(): HTMLAudioElement | null {
    if (this.isDisposed || !canUseAudioElement()) {
      return null;
    }
    if (this.bgmAudio) {
      return this.bgmAudio;
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.loop = true;
    this.applyBgmMix(audio);
    this.bgmAudio = audio;
    return audio;
  }

  private teardownBgmAudio() {
    if (!this.bgmAudio) return;
    this.bgmAudio.pause();
    this.bgmAudio.src = "";
    this.bgmAudio.load();
    this.bgmAudio = null;
    this.bgmTrackUrl = null;
  }

  private syncBgmSource(
    audio: HTMLAudioElement,
    trackUrl: string,
    options: { load?: boolean } = {},
  ) {
    const sourceChanged =
      this.bgmTrackUrl !== trackUrl ||
      audio.src !== this.toAbsoluteUrl(trackUrl);
    if (sourceChanged) {
      this.bgmTrackUrl = trackUrl;
      audio.src = trackUrl;
    }
    if (options.load === true && (sourceChanged || audio.readyState === 0)) {
      audio.load();
    }
    if (this.snapshot.bgmTrackUrl !== trackUrl) {
      this.updateSnapshot((prev) => ({
        ...prev,
        bgmTrackUrl: trackUrl,
      }));
    }
  }

  private applyMixToActiveAudio() {
    if (this.bgmAudio) {
      this.applyBgmMix(this.bgmAudio);
    }
    for (const playback of this.activeSfx.values()) {
      this.applySfxMix(playback);
    }
  }

  private applyBgmMix(audio: HTMLAudioElement) {
    audio.muted = this.snapshot.masterMuted || this.snapshot.bgmMuted;
    audio.volume = mapNormalizedBgmVolumeToGain(
      this.snapshot.bgmVolume * this.bgmBaseVolume,
    );
  }

  private applySfxMix(playback: ActiveSfxPlayback) {
    playback.audio.muted = this.snapshot.masterMuted || this.snapshot.sfxMuted;
    playback.audio.volume = clampVolume(
      this.snapshot.sfxVolume * playback.baseVolume,
    );
  }

  private updateSnapshot(
    updater: (current: SoundControllerSnapshot) => SoundControllerSnapshot,
  ) {
    const nextSnapshot = updater(this.snapshot);
    this.snapshot = nextSnapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private toAbsoluteUrl(value: string): string {
    if (typeof window === "undefined") return value;
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return value;
    }
  }
}
