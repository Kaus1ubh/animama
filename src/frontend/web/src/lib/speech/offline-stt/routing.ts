/**
 * Which offline speech-to-text engine serves the conversation language (ADR
 * 0024): Parakeet for English, SenseVoice-Small for Japanese, Korean and
 * Chinese. The stored offline preference (`stt_provider: "parakeet"`) means
 * "offline recognition"; the engine follows the language, read when a session
 * starts, so a language change applies from the next start.
 */
import {
  conversationLocale,
  type ConversationLocale,
} from "@/lib/speech/speech-language";

export type OfflineSttEngine = "parakeet" | "sensevoice";

export type OfflineSpeechRoute = {
  engine: OfflineSttEngine;
  /** The language the engine is prompted with. */
  language: "en" | ConversationLocale;
};

/** Route `locale`, by default the active UI Locale. */
export function routeOfflineSpeech(locale?: string | null): OfflineSpeechRoute {
  // An omitted locale falls through to conversationLocale's own default.
  const language = conversationLocale(locale);
  return language
    ? { engine: "sensevoice", language }
    : { engine: "parakeet", language: "en" };
}

/** The capability fields that report each engine's installed sets. */
type OfflineSpeechCapabilities = {
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
 * falling back: speech in a non-English language never moves to a browser
 * recognizer, which may send audio to a cloud service, because that
 * language's set is missing.
 */
export function offlineLanguageMissing(
  savedProvider: string | null | undefined,
  route: OfflineSpeechRoute,
  capabilities: OfflineSpeechCapabilities,
): boolean {
  return (
    savedProvider === "parakeet" &&
    route.engine === "sensevoice" &&
    !offlineSpeechAvailable(route, capabilities)
  );
}
