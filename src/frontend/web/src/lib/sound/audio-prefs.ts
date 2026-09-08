import { createLogger } from "@/lib/logger";
import type { SoundControllerSnapshot } from "./types";

const logger = createLogger("AudioPrefs");
const AUDIO_PREFS_VERSION = 2;
const MAX_REMEMBERED_ANIMAS = 100;

export type AudioPrefs = {
  version: 2;
  selectedBgmRuntimeIdByAnimaId: Record<string, string>;
  bgmMuted: boolean;
  sfxMuted: boolean;
  ttsMuted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  ttsVolume: number;
};

export const AUDIO_PREFS_KEY = "audioPrefs";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  version: AUDIO_PREFS_VERSION,
  selectedBgmRuntimeIdByAnimaId: {},
  bgmMuted: false,
  sfxMuted: false,
  ttsMuted: false,
  bgmVolume: 0.3,
  sfxVolume: 0.5,
  ttsVolume: 0.5,
};

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function selectedByAnima(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0].trim()) &&
          typeof entry[1] === "string" &&
          Boolean(entry[1].trim()),
      )
      .slice(-MAX_REMEMBERED_ANIMAS),
  );
}

/** Resolve version 2 preferences and safely discard legacy URL-based tracks. */
export function resolveAudioPrefs(value: unknown): AudioPrefs {
  if (!isRecord(value)) return { ...DEFAULT_AUDIO_PREFS };
  return {
    version: AUDIO_PREFS_VERSION,
    selectedBgmRuntimeIdByAnimaId:
      value.version === AUDIO_PREFS_VERSION
        ? selectedByAnima(value.selectedBgmRuntimeIdByAnimaId)
        : {},
    bgmMuted:
      typeof value.bgmMuted === "boolean"
        ? value.bgmMuted
        : DEFAULT_AUDIO_PREFS.bgmMuted,
    sfxMuted:
      typeof value.sfxMuted === "boolean"
        ? value.sfxMuted
        : DEFAULT_AUDIO_PREFS.sfxMuted,
    ttsMuted:
      typeof value.ttsMuted === "boolean"
        ? value.ttsMuted
        : DEFAULT_AUDIO_PREFS.ttsMuted,
    bgmVolume: clampVolume(value.bgmVolume, DEFAULT_AUDIO_PREFS.bgmVolume),
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
    | "bgmMuted"
    | "sfxMuted"
    | "ttsMuted"
    | "bgmVolume"
    | "sfxVolume"
    | "ttsVolume"
  >,
  selectedBgmRuntimeIdByAnimaId: Record<string, string>,
): AudioPrefs {
  return {
    version: AUDIO_PREFS_VERSION,
    selectedBgmRuntimeIdByAnimaId: selectedByAnima(
      selectedBgmRuntimeIdByAnimaId,
    ),
    bgmMuted: snapshot.bgmMuted,
    sfxMuted: snapshot.sfxMuted,
    ttsMuted: snapshot.ttsMuted,
    bgmVolume: clampVolume(snapshot.bgmVolume, DEFAULT_AUDIO_PREFS.bgmVolume),
    sfxVolume: clampVolume(snapshot.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
    ttsVolume: clampVolume(snapshot.ttsVolume, DEFAULT_AUDIO_PREFS.ttsVolume),
  };
}
