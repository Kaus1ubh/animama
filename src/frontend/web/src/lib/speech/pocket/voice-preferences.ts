import { getI18n } from "react-i18next";

import type { SpeechPreferences } from "@/lib/settings/preferences";

export const POCKET_TTS_CUSTOM_VOICE = "custom";

export function toPocketVoicePreference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolvePocketVoicePreference(
  speech?: SpeechPreferences | null,
): string | null {
  const animaOverride = toPocketVoicePreference(speech?.tts_pocket_anima_voice);
  if (animaOverride) return animaOverride;
  return toPocketVoicePreference(speech?.tts_pocket_voice);
}

export function hasPocketAnimaVoiceOverride(
  speech?: SpeechPreferences | null,
): boolean {
  return toPocketVoicePreference(speech?.tts_pocket_anima_voice) !== null;
}

export function isPocketCustomVoice(value: unknown): boolean {
  return toPocketVoicePreference(value) === POCKET_TTS_CUSTOM_VOICE;
}

export type PocketFallbackNotice = {
  /** "run" notices repeat per chat run; "session" notices show once per app session. */
  scope: "run" | "session";
  key: string;
  /** Worded in the UI Locale when the notice is resolved. */
  message: string;
};

export type PocketFallbackResolution = {
  voice: string | undefined;
  notice?: PocketFallbackNotice;
  /** A downloadable voice's asset to install before it can be used. */
  install?: string;
};

/** Install state of a downloadable voice (core voices have none). */
export type PocketVoiceAvailability = {
  /** `unknown` until the downloader's asset list has loaded. */
  status: "unknown" | "not_installed" | "downloading" | "installed" | "failed";
  assetId: string;
  progress?: number | null;
};

/**
 * Choose the Pocket voice for a run from the saved preference and the voices
 * the worker reported. A saved voice that no longer exists (for example one
 * removed from the built-in set) falls back to the default voice with a notice
 * shown once per session, not on every reply.
 */
export function resolvePocketFallbackVoice(
  configuredVoice: string | null,
  availableVoices: readonly string[],
  hasCustomVoice: boolean,
  defaultVoice: string,
  availability: (voiceId: string) => PocketVoiceAvailability | null = () =>
    null,
  /** Downloads have ended, so a voice that is not installed never will be. */
  downloadsEnded = false,
): PocketFallbackResolution {
  const fallback = availableVoices.includes(defaultVoice)
    ? defaultVoice
    : availableVoices[0];
  if (!configuredVoice) return { voice: fallback };
  const t = getI18n().getFixedT(null, "voice");
  if (isPocketCustomVoice(configuredVoice)) {
    if (hasCustomVoice) return { voice: configuredVoice };
    return {
      voice: undefined,
      notice: {
        scope: "run",
        key: "pocket_custom_missing",
        message: t("pocket.fallback.customMissing"),
      },
    };
  }
  if (
    availableVoices.length > 0 &&
    !availableVoices.includes(configuredVoice)
  ) {
    return {
      voice: fallback,
      notice: {
        scope: "session",
        key: `pocket_voice_unknown:${configuredVoice}`,
        message: t("pocket.fallback.unknownVoice", { voice: configuredVoice }),
      },
    };
  }
  const download = availability(configuredVoice);
  if (download && download.status !== "installed" && downloadsEnded)
    return {
      voice: fallback,
      notice: {
        scope: "session",
        key: `pocket_voice_downloads_ended:${configuredVoice}`,
        message: t("pocket.fallback.downloadsEnded", {
          voice: configuredVoice,
        }),
      },
    };
  if (download && download.status !== "installed") {
    // Speak with the default until the voice is installed; start (or retry) the
    // download unless one is already running.
    // Downloading, or state not yet known: speak with the default, no request.
    if (download.status === "downloading" || download.status === "unknown")
      return { voice: fallback };
    return {
      voice: fallback,
      install: download.assetId,
      ...(download.status === "failed"
        ? {
            notice: {
              scope: "session" as const,
              key: `pocket_voice_download_failed:${configuredVoice}`,
              message: t("pocket.fallback.downloadFailed", {
                voice: configuredVoice,
              }),
            },
          }
        : {}),
    };
  }
  return { voice: configuredVoice };
}

// App-lifetime record of shown session notices. Module state survives chat
// remounts (switching Animas or canvas modes), unlike component state.
const claimedSessionNotices = new Set<string>();

/** Return true the first time a session notice key is claimed in this app session. */
export function claimSessionNotice(key: string): boolean {
  if (claimedSessionNotices.has(key)) return false;
  claimedSessionNotices.add(key);
  return true;
}

/** The value computed for one run, reused by that run's later chunks. */
export type PerRunValue<T> = { runId: string; value: T } | null;

/**
 * Compute `resolve()` once per run and reuse it for the rest of that run. A
 * reply streams in several chunks; resolving the voice for each one would let a
 * download that finishes mid-reply switch voices partway through, and would
 * repeat install requests within one reply.
 */
export function resolveOncePerRun<T>(
  cache: { current: PerRunValue<T> },
  runId: string,
  resolve: () => T,
): T {
  if (cache.current?.runId === runId) return cache.current.value;
  const value = resolve();
  cache.current = { runId, value };
  return value;
}
