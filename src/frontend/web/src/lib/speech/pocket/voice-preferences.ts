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
