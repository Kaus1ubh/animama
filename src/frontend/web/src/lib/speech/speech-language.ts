import { activeUiLocale } from "@animama/product-ui/i18n";
import type { UiLocale } from "@animama/runtime-contracts/locale";

/** A UI Locale other than English: the language Animas then speak (ADR 0024). */
export type ConversationLocale = Exclude<UiLocale, "en">;

/** Tags the browser's own speech recognition and synthesis know each language by. */
const BROWSER_SPEECH_TAGS: Record<ConversationLocale, string> = {
  ja: "ja-JP",
  ko: "ko-KR",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
};

/**
 * The non-English language Animas speak, or `null` under English, the
 * development pseudo-locale and before i18n starts (speech keeps its default).
 */
export function conversationLocale(
  locale: string | null | undefined = activeUiLocale(),
): ConversationLocale | null {
  return locale && Object.hasOwn(BROWSER_SPEECH_TAGS, locale)
    ? (locale as ConversationLocale)
    : null;
}

/**
 * Tag for the browser's own speech recognition and synthesis under a
 * conversation language; `undefined` keeps the engine's usual language.
 */
export function browserSpeechLanguage(): string | undefined {
  const locale = conversationLocale();
  return locale ? BROWSER_SPEECH_TAGS[locale] : undefined;
}

/** Which way a speech engine works: listening (speech-to-text) or speaking. */
export type SpeechDirection = "speechToText" | "textToSpeech";

/**
 * Text-to-Speech engines that speak only English: Pocket TTS's English
 * checkpoint. Every other engine follows the language. Offline speech
 * recognition routes by language instead (`offline-stt/routing`).
 */
export function ttsEngineIsEnglishOnly(
  provider: string | null | undefined,
): boolean {
  return provider === "pocket_tts";
}

/** The Settings and stored choices that mean offline speech recognition. */
export function isOfflineSttChoice(
  provider: string | null | undefined,
): boolean {
  return provider === "parakeet" || provider === "parakeet_webgpu";
}
