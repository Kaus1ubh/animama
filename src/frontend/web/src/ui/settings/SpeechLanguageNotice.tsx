import { useTranslation } from "react-i18next";
import { localeNativeName } from "@animama/runtime-contracts/locale";

import {
  offlineSpeechAvailable,
  routeOfflineSpeech,
} from "@/lib/speech/offline-stt/routing";
import {
  conversationLocale,
  isOfflineSttChoice,
  ttsEngineIsEnglishOnly,
  type SpeechDirection,
} from "@/lib/speech/speech-language";
import { useOperatorManagedModelAssets } from "@/query/hooks/useModelAssets";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";

/**
 * Speech that does not cover the language Animas speak (ADR 0024): Pocket TTS
 * speaks English only, so the notice names the alternatives; offline speech
 * recognition needs the language's model, so the notice asks for its download
 * (or says the server does not provide it, where the operator manages models
 * or turned the installed set off). Renders nothing under English,
 * for an engine that follows the language or while the runtime is unknown.
 */
export function SpeechLanguageNotice({
  direction,
  provider,
}: {
  direction: SpeechDirection;
  provider: string | null | undefined;
}) {
  const { t, i18n } = useTranslation("voice");
  const capabilities = useRuntimeCapabilities().data;
  const operatorManaged = useOperatorManagedModelAssets();
  // Read through `i18n` so the notice follows a language switch.
  const locale = conversationLocale(i18n.resolvedLanguage);
  if (!locale) return null;
  const language = localeNativeName(locale);
  if (direction === "textToSpeech")
    return ttsEngineIsEnglishOnly(provider) ? (
      <p className="text-warning text-xs">
        {t("languageNotice.textToSpeech", { language })}
      </p>
    ) : null;
  if (
    !isOfflineSttChoice(provider) ||
    !capabilities ||
    offlineSpeechAvailable(routeOfflineSpeech(locale), capabilities)
  )
    return null;
  // A set that is installed (it reports a version) yet unavailable was
  // turned off by the operator; downloading cannot help.
  const turnedOff = Boolean(
    capabilities.offline_multilingual_speech_asset_version,
  );
  return (
    <p className="text-warning text-xs">
      {operatorManaged || turnedOff
        ? t("languageNotice.speechToTextUnavailable", { language })
        : t("languageNotice.speechToText", { language })}
    </p>
  );
}
