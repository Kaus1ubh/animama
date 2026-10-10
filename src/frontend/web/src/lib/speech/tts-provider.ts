"use client";

import type { TtsProviderPreference } from "@/lib/settings/preferences";
import {
  getRuntimePlatformSnapshot,
  type RuntimePlatform,
} from "@/platform/runtime-platform";

export type TtsProvider = TtsProviderPreference;

export const TTS_PROVIDERS = [
  "browser",
  "pocket_tts",
  "elevenlabs",
] as const satisfies readonly TtsProvider[];

type TtsProviderSet = Record<TtsProvider, true>;

const TTS_PROVIDER_SET: TtsProviderSet = {
  browser: true,
  pocket_tts: true,
  elevenlabs: true,
};

export type TtsProviderOption = {
  id: TtsProvider;
  label: string;
  description: string;
  disabled: boolean;
  reason?: string;
};

export type ResolveTtsProviderResult = {
  provider: TtsProvider | null;
  hasExplicitPreference: boolean;
};

type ResolveTtsProviderInput = {
  savedProvider?: TtsProvider | null;
  platform?: RuntimePlatform;
};

type SpeechSynthesisWindow = Window &
  typeof globalThis & {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };

function asSpeechSynthesisWindow(): SpeechSynthesisWindow | null {
  if (typeof window === "undefined") return null;
  return window as SpeechSynthesisWindow;
}

export function toTtsProvider(value: unknown): TtsProvider | null {
  if (typeof value !== "string") return null;
  if (value in TTS_PROVIDER_SET) return value as TtsProvider;
  return null;
}

/**
 * Whether to warm up and preload Pocket TTS from the effective preferences.
 *
 * Until the owner's settings are read (and if reading them fails), preferences
 * resolve from the defaults, which turn Pocket TTS on. Preparing it then would
 * download and run Pocket TTS for owners who turned speech off or chose another
 * provider; a reply that needs Pocket still starts it on demand.
 */
export function shouldPreparePocketTts(
  settingsLoaded: boolean,
  ttsEnabled: boolean | undefined,
  ttsProvider: unknown,
  supported: () => boolean = isPocketTtsSupported,
): boolean {
  return (
    settingsLoaded &&
    ttsEnabled === true &&
    toTtsProvider(ttsProvider) === "pocket_tts" &&
    supported()
  );
}

export function isBrowserSpeechSynthesisSupported(
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): boolean {
  if (platform.isDesktop) return false;
  const speechWindow = asSpeechSynthesisWindow();
  if (!speechWindow) return false;
  return (
    typeof speechWindow.speechSynthesis !== "undefined" &&
    typeof speechWindow.SpeechSynthesisUtterance !== "undefined"
  );
}

export function isPocketTtsSupported(): boolean {
  const speechWindow = asSpeechSynthesisWindow();
  if (!speechWindow) return false;
  if (!speechWindow.isSecureContext) return false;
  if (typeof speechWindow.Worker === "undefined") return false;

  const AudioContextCtor =
    speechWindow.AudioContext ?? speechWindow.webkitAudioContext;
  if (!AudioContextCtor || !AudioContextCtor.prototype) return false;

  return "audioWorklet" in AudioContextCtor.prototype;
}

export function isElevenLabsTtsSupported(): boolean {
  const speechWindow = asSpeechSynthesisWindow();
  if (!speechWindow) return false;
  if (!speechWindow.isSecureContext) return false;
  if (typeof speechWindow.WebSocket === "undefined") return false;

  const AudioContextCtor =
    speechWindow.AudioContext ?? speechWindow.webkitAudioContext;
  if (!AudioContextCtor || !AudioContextCtor.prototype) return false;

  return "audioWorklet" in AudioContextCtor.prototype;
}

function getPocketTtsUnsupportedReason(): string | undefined {
  const speechWindow = asSpeechSynthesisWindow();
  if (!speechWindow) return "PocketTTS can only run in a browser context.";
  if (!speechWindow.isSecureContext) {
    return "PocketTTS requires HTTPS or localhost (secure context).";
  }
  if (typeof speechWindow.Worker === "undefined") {
    return "Web Workers are not supported in this browser.";
  }
  const AudioContextCtor =
    speechWindow.AudioContext ?? speechWindow.webkitAudioContext;
  if (!AudioContextCtor || !AudioContextCtor.prototype) {
    return "Web Audio API is not supported in this browser.";
  }
  if (!("audioWorklet" in AudioContextCtor.prototype)) {
    return "AudioWorklet is not supported in this browser.";
  }
  return undefined;
}

function getElevenLabsTtsUnsupportedReason(): string | undefined {
  const speechWindow = asSpeechSynthesisWindow();
  if (!speechWindow) return "ElevenLabs TTS can only run in a browser context.";
  if (!speechWindow.isSecureContext) {
    return "ElevenLabs TTS requires HTTPS or localhost (secure context).";
  }
  if (typeof speechWindow.WebSocket === "undefined") {
    return "WebSocket is not supported in this browser.";
  }
  const AudioContextCtor =
    speechWindow.AudioContext ?? speechWindow.webkitAudioContext;
  if (!AudioContextCtor || !AudioContextCtor.prototype) {
    return "Web Audio API is not supported in this browser.";
  }
  if (!("audioWorklet" in AudioContextCtor.prototype)) {
    return "AudioWorklet is not supported in this browser.";
  }
  return undefined;
}

export function isTtsProviderSupported(
  provider: TtsProvider,
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): boolean {
  if (provider === "browser")
    return isBrowserSpeechSynthesisSupported(platform);
  if (provider === "pocket_tts") return isPocketTtsSupported();
  if (provider === "elevenlabs") return isElevenLabsTtsSupported();
  return false;
}

export function getTtsProviderOptions(
  platform: RuntimePlatform = getRuntimePlatformSnapshot(),
): TtsProviderOption[] {
  const isDesktop = platform.isDesktop;
  const browserSupported = isBrowserSpeechSynthesisSupported(platform);
  const pocketSupported = isPocketTtsSupported();
  const pocketReason = getPocketTtsUnsupportedReason();
  const elevenlabsSupported = isElevenLabsTtsSupported();
  const elevenlabsReason = getElevenLabsTtsUnsupportedReason();

  const options: TtsProviderOption[] = [
    {
      id: "browser",
      label: "Browser",
      description: "Browser speech synthesis via the Web Speech API.",
      disabled: !browserSupported,
      reason: browserSupported
        ? undefined
        : isDesktop
          ? "Browser TTS is unavailable in the desktop app."
          : "Speech synthesis is not supported in this browser.",
    },
    {
      id: "pocket_tts",
      label: "PocketTTS",
      description: "Client-side PocketTTS synthesis.",
      disabled: !pocketSupported,
      reason: pocketReason,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      description: "ElevenLabs synthesis with realtime and finalized models.",
      disabled: !elevenlabsSupported,
      reason: elevenlabsReason,
    },
  ];

  return isDesktop
    ? options.filter((option) => option.id !== "browser")
    : options;
}

export function resolvePreferredTtsProvider({
  savedProvider = null,
  platform = getRuntimePlatformSnapshot(),
}: ResolveTtsProviderInput = {}): ResolveTtsProviderResult {
  if (savedProvider && isTtsProviderSupported(savedProvider, platform)) {
    return {
      provider: savedProvider,
      hasExplicitPreference: true,
    };
  }

  if (isTtsProviderSupported("elevenlabs", platform)) {
    return {
      provider: "elevenlabs",
      hasExplicitPreference: false,
    };
  }

  const firstSupported = TTS_PROVIDERS.find((provider) =>
    isTtsProviderSupported(provider, platform),
  );

  return {
    provider: firstSupported ?? null,
    hasExplicitPreference: false,
  };
}
