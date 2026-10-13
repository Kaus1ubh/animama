import { useTranslation } from "react-i18next";
import { localeNativeName } from "@animama/runtime-contracts/locale";

import {
  conversationLocale,
  speechEngineIsEnglishOnly,
  type SpeechDirection,
} from "@/lib/speech/speech-language";

/**
 * Warns that the chosen speech engine works only in English while Animas speak
 * the app's language, and names the alternative (ADR 0024). Renders nothing
 * under English or for an engine that follows the language.
 */
export function SpeechLanguageNotice({
  direction,
  provider,
}: {
  direction: SpeechDirection;
  provider: string | null | undefined;
}) {
  const { t, i18n } = useTranslation("voice");
  // Read through `i18n` so the notice follows a language switch.
  const locale = conversationLocale(i18n.resolvedLanguage);
  if (!locale || !speechEngineIsEnglishOnly(direction, provider)) return null;
  const language = localeNativeName(locale);
  return (
    <p className="text-warning text-xs">
      {direction === "speechToText"
        ? t("languageNotice.speechToText", { language })
        : t("languageNotice.textToSpeech", { language })}
    </p>
  );
}
