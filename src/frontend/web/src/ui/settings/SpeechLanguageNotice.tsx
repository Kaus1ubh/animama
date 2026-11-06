import { useTranslation } from "react-i18next";
import { localeNativeName } from "@animama/runtime-contracts/locale";

import {
  offlineSpeechAvailable,
  routeOfflineSpeech,
  type OfflineSttEngine,
} from "@/lib/speech/offline-stt/routing";
import {
  conversationLocale,
  isOfflineSttChoice,
  ttsEngineIsEnglishOnly,
  type SpeechDirection,
} from "@/lib/speech/speech-language";
import { useOperatorManagedModelAssets } from "@/query/hooks/useModelAssets";
import { useModelDownloadsEnded } from "@/query/hooks/useModelDownloadsEnded";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";

/**
 * Speech that does not cover the language Animas speak (ADR 0024): Pocket TTS
 * and Parakeet work in English only, so the notice names the alternatives.
 * SenseVoice needs its model, so the notice asks for its download, says that
 * it can no longer be downloaded, or says the server does not provide it
 * (where the operator manages models or turned the installed set off).
 * Renders nothing for an engine that covers the language and is available, or
 * while the runtime is unknown.
 */
export function SpeechLanguageNotice({
  direction,
  provider,
  engine = null,
}: {
  direction: SpeechDirection;
  provider: string | null | undefined;
  /** The owner's saved offline engine; `null` follows the UI Locale. */
  engine?: OfflineSttEngine | null;
}) {
  const { t, i18n } = useTranslation("voice");
  const capabilities = useRuntimeCapabilities().data;
  const operatorManaged = useOperatorManagedModelAssets();
  const downloadsEnded = useModelDownloadsEnded();
  // Read through `i18n` so the notice follows a language switch.
  const locale = conversationLocale(i18n.resolvedLanguage);
  const language = locale ? localeNativeName(locale) : null;
  if (direction === "textToSpeech")
    return language && ttsEngineIsEnglishOnly(provider) ? (
      <p className="text-warning text-xs">
        {t("languageNotice.textToSpeech", { language })}
      </p>
    ) : null;
  if (!isOfflineSttChoice(provider)) return null;
  const route = routeOfflineSpeech(i18n.resolvedLanguage, engine);
  // Parakeet runs (it was chosen) but cannot hear the app's language.
  if (route.engine === "parakeet")
    return language ? (
      <p className="text-warning text-xs">
        {t("languageNotice.speechToTextEnglishOnly", { language })}
      </p>
    ) : null;
  if (!capabilities || offlineSpeechAvailable(route, capabilities)) return null;
  // A set that is installed (it reports a version) yet unavailable was
  // turned off by the operator; downloading cannot help.
  const unavailable =
    operatorManaged ||
    Boolean(capabilities.offline_multilingual_speech_asset_version);
  return (
    <p className="text-warning text-xs">
      {language
        ? unavailable
          ? t("languageNotice.speechToTextUnavailable", { language })
          : downloadsEnded
            ? t("languageNotice.speechToTextEnded", { language })
            : t("languageNotice.speechToText", { language })
        : unavailable
          ? t("languageNotice.speechToTextModelUnavailable")
          : downloadsEnded
            ? t("languageNotice.speechToTextModelEnded")
            : t("languageNotice.speechToTextModel")}
    </p>
  );
}
