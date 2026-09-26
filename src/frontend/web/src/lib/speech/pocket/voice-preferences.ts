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
  message: string;
};

export type PocketFallbackResolution = {
  voice: string | undefined;
  notice?: PocketFallbackNotice;
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
): PocketFallbackResolution {
  const fallback = availableVoices.includes(defaultVoice)
    ? defaultVoice
    : availableVoices[0];
  if (!configuredVoice) return { voice: fallback };
  if (isPocketCustomVoice(configuredVoice)) {
    if (hasCustomVoice) return { voice: configuredVoice };
    return {
      voice: undefined,
      notice: {
        scope: "run",
        key: "pocket_custom_missing",
        message:
          "Custom PocketTTS voice is selected but no custom voice has been uploaded.",
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
        message: `The saved voice "${configuredVoice}" is no longer available, so the default voice is used. Choose another voice in Anima settings.`,
      },
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
