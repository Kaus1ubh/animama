/**
 * Which offline speech-to-text engine runs, and in which language. The owner
 * may choose the engine (`speech.stt_offline_engine`, ADR 0031); without a
 * choice it follows the conversation language (ADR 0024): Parakeet for
 * English, SenseVoice-Small for Japanese, Korean and Chinese. The stored
 * offline preference (`stt_provider: "parakeet"`) means "offline
 * recognition" with either engine. The route is read when a session starts,
 * so a language or engine change applies from the next start.
 */
import {
  conversationLocale,
  type ConversationLocale,
} from "@/lib/speech/speech-language";

export type OfflineSttEngine = "parakeet" | "sensevoice";

/**
 * The language an engine is prompted with: English for Parakeet; for
 * SenseVoice the conversation language, or `auto` (automatic language
 * detection) when SenseVoice is chosen under English.
 */
export type OfflineSpeechLanguage = "en" | "auto" | ConversationLocale;

export type OfflineSpeechRoute = {
  engine: OfflineSttEngine;
  /** The language the engine is prompted with. */
  language: OfflineSpeechLanguage;
  /**
   * Whether a missing set may fall back to a browser recognizer: only
   * Parakeet under English, as before engines could be chosen. Otherwise a
   * saved offline choice stops with "not installed", because a browser
   * recognizer may send audio to a cloud service.
   */
  browserFallback: boolean;
};

/**
 * Route `locale` (by default the active UI Locale) with the owner's saved
 * engine, or the locale's own engine when `engine` is absent.
 */
export function routeOfflineSpeech(
  locale?: string | null,
  engine?: OfflineSttEngine | null,
): OfflineSpeechRoute {
  // An omitted locale falls through to conversationLocale's own default.
  const language = conversationLocale(locale);
  const chosen = engine ?? (language ? "sensevoice" : "parakeet");
  if (chosen === "parakeet")
    return { engine: "parakeet", language: "en", browserFallback: !language };
  // Under English SenseVoice detects the language, so English, Japanese,
  // Korean, Mandarin and Cantonese all transcribe.
  return {
    engine: "sensevoice",
    language: language ?? "auto",
    browserFallback: false,
  };
}

/** The capability fields that report each engine's installed sets. */
export type OfflineSpeechCapabilities = {
  offline_speech_enabled: boolean;
  offline_multilingual_speech_enabled?: boolean;
};

export function offlineSpeechAvailable(
  route: OfflineSpeechRoute,
  capabilities: OfflineSpeechCapabilities,
): boolean {
  return route.engine === "parakeet"
    ? capabilities.offline_speech_enabled
    : capabilities.offline_multilingual_speech_enabled === true;
}

/**
 * Whether a saved offline choice must stop with "not installed" instead of
 * falling back: its engine's set is missing and the route allows no browser
 * recognizer, which may send audio to a cloud service.
 */
export function offlineLanguageMissing(
  savedProvider: string | null | undefined,
  route: OfflineSpeechRoute,
  capabilities: OfflineSpeechCapabilities,
): boolean {
  return (
    savedProvider === "parakeet" &&
    !route.browserFallback &&
    !offlineSpeechAvailable(route, capabilities)
  );
}
