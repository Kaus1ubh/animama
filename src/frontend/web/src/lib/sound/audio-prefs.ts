import { createLogger } from "@/lib/logger";
import type { SoundControllerSnapshot } from "./types";
import { isRecord } from "@/lib/records";

const logger = createLogger("AudioPrefs");
const AUDIO_PREFS_VERSION = 3;

export type AudioPrefs = {
  version: 3;
  sfxMuted: boolean;
  ttsMuted: boolean;
  sfxVolume: number;
  ttsVolume: number;
};

export const AUDIO_PREFS_KEY = "audioPrefs";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  version: AUDIO_PREFS_VERSION,
  sfxMuted: false,
  ttsMuted: false,
  sfxVolume: 0.5,
  ttsVolume: 0.5,
};

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/** Keep TTS/SFX preferences across versions; retired Music settings are ignored. */
export function resolveAudioPrefs(value: unknown): AudioPrefs {
  if (!isRecord(value)) return { ...DEFAULT_AUDIO_PREFS };
  return {
    version: AUDIO_PREFS_VERSION,
    sfxMuted:
      typeof value.sfxMuted === "boolean"
        ? value.sfxMuted
        : DEFAULT_AUDIO_PREFS.sfxMuted,
    ttsMuted:
      typeof value.ttsMuted === "boolean"
        ? value.ttsMuted
        : DEFAULT_AUDIO_PREFS.ttsMuted,
    sfxVolume: clampVolume(value.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
    ttsVolume: clampVolume(value.ttsVolume, DEFAULT_AUDIO_PREFS.ttsVolume),
  };
}

export function loadAudioPrefs(): AudioPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_KEY);
    return raw ? resolveAudioPrefs(JSON.parse(raw)) : null;
  } catch (error) {
    logger.warn("Storage", "Failed to load audio preferences", { error });
    return null;
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    logger.warn("Storage", "Failed to save audio preferences", { error });
  }
}

export function getAudioPrefsFromSnapshot(
  snapshot: Pick<
    SoundControllerSnapshot,
    "sfxMuted" | "ttsMuted" | "sfxVolume" | "ttsVolume"
  >,
): AudioPrefs {
  return {
    version: AUDIO_PREFS_VERSION,
    sfxMuted: snapshot.sfxMuted,
    ttsMuted: snapshot.ttsMuted,
    sfxVolume: clampVolume(snapshot.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
    ttsVolume: clampVolume(snapshot.ttsVolume, DEFAULT_AUDIO_PREFS.ttsVolume),
  };
}
