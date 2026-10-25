import { getI18n } from "react-i18next";

import {
  isParakeetWebgpuPreferred,
  offlineSttEnginePreference,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
import {
  routeOfflineSpeech,
  type OfflineSpeechCapabilities,
} from "@/lib/speech/offline-stt/routing";
import {
  offlineSttShortName,
  resolveRoutedSttProvider,
  toSttProvider,
} from "@/lib/speech/stt-provider";
import {
  resolvePreferredTtsProvider,
  toTtsProvider,
  type TtsProvider,
} from "@/lib/speech/tts-provider";
import type { RuntimePlatform } from "@/platform/runtime-platform";

/** Tooltip lines naming the speech engines Dictate and Voice Mode use. */
export type ComposerSpeechEngines = {
  /** ["STT: SenseVoice CPU"]; null until runtime capabilities load. */
  dictation: string[] | null;
  /** ["STT: SenseVoice CPU", "TTS: ElevenLabs"]; null until capabilities load. */
  voiceMode: string[] | null;
};

/**
 * Names the engines a Dictate or Voice Mode start would pick from the saved
 * speech preferences, with the same resolution the dictation and TTS hooks
 * use at start. A running session may still fall back (WebGPU to the CPU,
 * ElevenLabs to PocketTTS); the tooltip shows the configured choice.
 */
export function composerSpeechEngines({
  preferences,
  platform,
  locale,
  capabilities,
}: {
  preferences: SettingsPreferences | null | undefined;
  platform: RuntimePlatform;
  /** The UI Locale, which picks the offline engine unless one is saved. */
  locale: string | undefined;
  capabilities:
    | (OfflineSpeechCapabilities & { gemini_tts?: unknown })
    | undefined;
}): ComposerSpeechEngines {
  if (!capabilities) return { dictation: null, voiceMode: null };
  const t = getI18n().getFixedT(null, "chat");
  const tVoice = getI18n().getFixedT(null, "voice");
  const route = routeOfflineSpeech(
    locale,
    offlineSttEnginePreference(preferences),
  );
  const { provider: sttProvider } = resolveRoutedSttProvider({
    savedProvider: toSttProvider(preferences?.speech?.stt_provider),
    platform,
    route,
    capabilities,
  });
  const stt =
    sttProvider === "parakeet"
      ? t("composer.speechEngines.offline", {
          engine: offlineSttShortName(route.engine),
          variant: isParakeetWebgpuPreferred(preferences)
            ? tVoice("providers.stt.variants.gpu")
            : tVoice("providers.stt.variants.cpu"),
        })
      : sttProvider === "browser_local"
        ? tVoice("providers.stt.browserLocal.label")
        : tVoice("providers.stt.browserLabel");
  const ttsProvider =
    preferences?.speech?.tts_enabled === true
      ? resolvePreferredTtsProvider({
          savedProvider: toTtsProvider(preferences.speech.tts_provider),
          platform,
          offers: { gemini: capabilities.gemini_tts != null },
        }).provider
      : null;
  const sttLine = t("composer.speechEngines.stt", { stt });
  const ttsLine = t("composer.speechEngines.tts", {
    tts: ttsProvider
      ? ttsProviderName(ttsProvider, tVoice("providers.tts.browser.label"))
      : t("composer.speechEngines.ttsOff"),
  });
  return { dictation: [sttLine], voiceMode: [sttLine, ttsLine] };
}

/** A TTS provider's product name; only the browser's is translated. */
function ttsProviderName(provider: TtsProvider, browserName: string): string {
  switch (provider) {
    case "browser":
      return browserName;
    case "pocket_tts":
      return "PocketTTS";
    case "elevenlabs":
      return "ElevenLabs";
    case "gemini":
      return "Gemini";
  }
}
