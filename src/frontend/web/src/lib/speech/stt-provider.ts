import { getI18n } from "react-i18next";

import type { SttProviderPreference } from "@/lib/settings/preferences";
import {
  offlineLanguageMissing,
  offlineSpeechAvailable,
  routeOfflineSpeech,
  type OfflineSpeechCapabilities,
  type OfflineSpeechRoute,
  type OfflineSttEngine,
} from "@/lib/speech/offline-stt/routing";
import {
  getRuntimePlatformSnapshot,
  type RuntimePlatform,
} from "@/platform/runtime-platform";

export type SttProvider = SttProviderPreference;

export const STT_PROVIDERS = [
  "parakeet",
  "browser_external",
  "browser_local",
] as const satisfies readonly SttProvider[];

type SttProviderSet = Record<SttProvider, true>;

const STT_PROVIDER_SET: SttProviderSet = {
  parakeet: true,
  browser_external: true,
  browser_local: true,
};

/** A provider choice; its text is worded in the UI Locale when it is listed. */
export type SttProviderOption = {
  id: SttProvider;
  label: string;
  description: string;
  disabled: boolean;
  reason?: string;
};

export interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export interface BrowserSpeechRecognitionResultLike {
  isFinal?: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative | undefined;
}

export interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex?: number;
  results: ArrayLike<BrowserSpeechRecognitionResultLike>;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string;
  message?: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export type BrowserSpeechRecognitionConstructor =
  new () => BrowserSpeechRecognition;

export type ResolveSttProviderResult = {
  provider: SttProvider;
  hasExplicitPreference: boolean;
  parakeetAvailable: boolean | null;
};

type ResolveSttProviderInput = {
  savedProvider?: SttProvider | null;
  platform?: RuntimePlatform;
  parakeetAvailable?: boolean | null;
};

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

function asSpeechWindow(): SpeechWindow | null {
  if (typeof window === "undefined") return null;
  return window as SpeechWindow;
}

export function toSttProvider(value: unknown): SttProvider | null {
  if (typeof value !== "string") return null;
  if (value in STT_PROVIDER_SET) return value as SttProvider;
  return null;
}

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const speechWindow = asSpeechWindow();
  if (!speechWindow) return null;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

export function isWebSpeechSupported(
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): boolean {
  if (platform.isDesktop) return false;
  return getSpeechRecognitionConstructor() !== null;
}

export function supportsLocalWebSpeechStrict(
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): boolean {
  if (platform.isDesktop) return false;
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) return false;
  try {
    const recognition = new SpeechRecognition();
    return "processLocally" in recognition;
  } catch {
    return false;
  }
}

export function isSttProviderSupported(
  provider: SttProvider,
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
  parakeetAvailable: boolean | null = null,
): boolean {
  if (provider === "parakeet") return parakeetAvailable === true;
  if (provider === "browser_external") return isWebSpeechSupported(platform);
  return supportsLocalWebSpeechStrict(platform);
}

/** An offline engine's short name for choice labels ("SenseVoice (CPU)"). */
export function offlineSttShortName(engine: OfflineSttEngine): string {
  return engine === "parakeet" ? "Parakeet" : "SenseVoice";
}

/** The model an offline engine runs, as Settings names it. */
export function offlineSttModelName(engine: OfflineSttEngine): string {
  const t = getI18n().getFixedT(null, "voice");
  return engine === "parakeet"
    ? t("offlineSpeech.engines.parakeet.model")
    : t("offlineSpeech.engines.sensevoice.model");
}

/**
 * The provider choices on this platform. The offline choice (`parakeet`) is
 * served by `engine`, the offline engine that runs (by default the UI
 * Locale's), and `parakeetAvailable` reports that engine's sets. A missing
 * SenseVoice set has no reason here: `SpeechLanguageNotice` explains it.
 */
export function getSttProviderOptions(
  parakeetAvailable: boolean | null = null,
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
  engine: OfflineSttEngine = routeOfflineSpeech().engine,
): SttProviderOption[] {
  const t = getI18n().getFixedT(null, "voice");
  const isDesktop = platform.isDesktop;
  const webSpeechSupported = isWebSpeechSupported(platform);
  const localSupported = supportsLocalWebSpeechStrict(platform);
  const desktopBrowserReason = t("providers.stt.browserDesktopUnavailable");
  const model = offlineSttModelName(engine);

  const options: SttProviderOption[] = [
    {
      id: "parakeet",
      label: t("providers.stt.parakeet.cpuLabel", {
        model: offlineSttShortName(engine),
      }),
      description: isDesktop
        ? t("providers.stt.parakeet.descriptionDesktop", { model })
        : t("providers.stt.parakeet.descriptionBrowser", { model }),
      disabled: parakeetAvailable !== true,
      reason:
        parakeetAvailable === false && engine === "parakeet"
          ? isDesktop
            ? t("providers.stt.parakeet.notInstalled")
            : t("providers.stt.parakeet.unavailableBrowser")
          : undefined,
    },
    {
      id: "browser_external",
      label: t("providers.stt.browserExternal.label"),
      description: t("providers.stt.browserExternal.description"),
      disabled: !webSpeechSupported,
      reason: webSpeechSupported
        ? undefined
        : isDesktop
          ? desktopBrowserReason
          : t("providers.stt.browserExternal.unsupported"),
    },
    {
      id: "browser_local",
      label: t("providers.stt.browserLocal.label"),
      description: t("providers.stt.browserLocal.description"),
      disabled: !localSupported,
      reason: localSupported
        ? undefined
        : isDesktop
          ? desktopBrowserReason
          : t("providers.stt.browserLocal.unsupported"),
    },
  ];

  return isDesktop
    ? options.filter((option) => option.id === "parakeet")
    : options;
}

export function resolvePreferredSttProvider({
  savedProvider = null,
  platform = getRuntimePlatformSnapshot(),
  parakeetAvailable = null,
}: ResolveSttProviderInput = {}): ResolveSttProviderResult {
  if (
    savedProvider &&
    isSttProviderSupported(savedProvider, platform, parakeetAvailable)
  ) {
    return {
      provider: savedProvider,
      hasExplicitPreference: true,
      parakeetAvailable,
    };
  }

  if (isWebSpeechSupported(platform)) {
    return {
      provider: "browser_external",
      hasExplicitPreference: false,
      parakeetAvailable,
    };
  }

  return {
    provider: "parakeet",
    hasExplicitPreference: false,
    parakeetAvailable,
  };
}

export type ResolveRoutedSttProviderResult = ResolveSttProviderResult & {
  /** The saved offline choice cannot run: the language's set is missing. */
  languageMissing: boolean;
};

/**
 * The provider for a session, or shown in Settings, with the offline choice
 * served by `route`'s engine. A saved offline choice whose set is missing
 * stays offline and reports `languageMissing` rather than falling back to a
 * browser recognizer, which may send audio to a cloud service; only Parakeet
 * under English falls back (`OfflineSpeechRoute.browserFallback`).
 */
export function resolveRoutedSttProvider({
  savedProvider = null,
  platform = getRuntimePlatformSnapshot(),
  route,
  capabilities,
}: {
  savedProvider?: SttProvider | null;
  platform?: RuntimePlatform;
  route: OfflineSpeechRoute;
  capabilities: OfflineSpeechCapabilities;
}): ResolveRoutedSttProviderResult {
  if (offlineLanguageMissing(savedProvider, route, capabilities))
    return {
      provider: "parakeet",
      hasExplicitPreference: true,
      parakeetAvailable: false,
      languageMissing: true,
    };
  return {
    ...resolvePreferredSttProvider({
      savedProvider,
      platform,
      parakeetAvailable: offlineSpeechAvailable(route, capabilities),
    }),
    languageMissing: false,
  };
}
