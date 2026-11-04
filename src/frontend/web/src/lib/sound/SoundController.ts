import { createLogger } from "@/lib/logger";

import type {
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
    this.listeners.clear();
  }

  restorePersistedState(prefs: AudioPrefs) {
    this.updateSnapshot((prev) => ({
      ...prev,
      sfxMuted: prefs.sfxMuted,
      ttsMuted: prefs.ttsMuted,
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

  private applyMixToActiveAudio() {
    for (const playback of this.activeSfx.values()) {
      this.applySfxMix(playback);
    }
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
}
