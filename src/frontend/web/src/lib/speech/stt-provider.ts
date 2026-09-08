"use client";

import type { SttProviderPreference } from "@/lib/settings/preferences";
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

export function getSttProviderOptions(
  parakeetAvailable: boolean | null = null,
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): SttProviderOption[] {
  const isDesktop = platform.isDesktop;
  const webSpeechSupported = isWebSpeechSupported(platform);
  const localSupported = supportsLocalWebSpeechStrict(platform);
  const desktopBrowserReason = "Browser STT is unavailable in the desktop app.";

  const options: SttProviderOption[] = [
    {
      id: "parakeet",
      label: "Parakeet",
      description: isDesktop
        ? "Local ONNX speech recognition in the desktop app."
        : "Local ONNX speech recognition in this browser.",
      disabled: parakeetAvailable !== true,
      reason:
        parakeetAvailable === false
          ? isDesktop
            ? "Install offline speech recognition to use dictation and Voice Mode."
            : "Local Parakeet is currently unavailable in this browser."
          : undefined,
    },
    {
      id: "browser_external",
      label: "Browser (external)",
      description: "Browser speech recognition with vendor-managed processing.",
      disabled: !webSpeechSupported,
      reason: webSpeechSupported
        ? undefined
        : isDesktop
          ? desktopBrowserReason
          : "Web Speech API is not supported in this browser.",
    },
    {
      id: "browser_local",
      label: "Browser (local)",
      description:
        "Strict on-device browser recognition when explicitly supported.",
      disabled: !localSupported,
      reason: localSupported
        ? undefined
        : isDesktop
          ? desktopBrowserReason
          : "Local-only Web Speech recognition is not supported in this browser.",
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
