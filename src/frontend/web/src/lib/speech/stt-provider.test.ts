import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSttProviderOptions,
  isSttProviderSupported,
  resolvePreferredSttProvider,
  resolveRoutedSttProvider,
} from "./stt-provider";
import { routeOfflineSpeech } from "./offline-stt/routing";
import type { RuntimePlatform } from "@/platform/runtime-platform";

const desktop = { kind: "desktop", isDesktop: true } as RuntimePlatform;
const browser = { kind: "web", isDesktop: false } as RuntimePlatform;

describe("optional offline speech capability", () => {
  it("does not treat absent or unknown Parakeet as supported", () => {
    for (const available of [false, null]) {
      expect(isSttProviderSupported("parakeet", desktop, available)).toBe(
        false,
      );
      expect(getSttProviderOptions(available, desktop)).toMatchObject([
        { id: "parakeet", disabled: true },
      ]);
      expect(
        resolvePreferredSttProvider({
          platform: desktop,
          parakeetAvailable: available,
        }).parakeetAvailable,
      ).toBe(available);
    }
  });
  it("resolves an installed Parakeet without offering unsupported browser providers", () => {
    expect(
      resolvePreferredSttProvider({
        platform: desktop,
        savedProvider: "parakeet",
        parakeetAvailable: true,
      }),
    ).toEqual({
      provider: "parakeet",
      hasExplicitPreference: true,
      parakeetAvailable: true,
    });
    expect(getSttProviderOptions(true, desktop)).toMatchObject([
      { id: "parakeet", disabled: false },
    ]);
  });
});

describe("provider resolution under the conversation language", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** A browser with cloud Web Speech recognition. */
  const withWebSpeech = () =>
    vi.stubGlobal("window", { webkitSpeechRecognition: class {} });
  const capabilities = (senseVoice: boolean, parakeet = true) => ({
    offline_speech_enabled: parakeet,
    offline_multilingual_speech_enabled: senseVoice,
  });

  it("keeps a saved offline choice when the language's set is missing, even with Web Speech", () => {
    withWebSpeech();
    expect(
      resolveRoutedSttProvider({
        savedProvider: "parakeet",
        platform: browser,
        route: routeOfflineSpeech("ja"),
        capabilities: capabilities(false),
      }),
    ).toEqual({
      provider: "parakeet",
      hasExplicitPreference: true,
      parakeetAvailable: false,
      languageMissing: true,
    });
  });

  it("runs the saved offline choice once the language's set is installed", () => {
    withWebSpeech();
    expect(
      resolveRoutedSttProvider({
        savedProvider: "parakeet",
        platform: browser,
        route: routeOfflineSpeech("ja"),
        capabilities: capabilities(true, false),
      }),
    ).toMatchObject({
      provider: "parakeet",
      parakeetAvailable: true,
      languageMissing: false,
    });
  });

  it("keeps a chosen SenseVoice under English offline when its set is missing", () => {
    withWebSpeech();
    expect(
      resolveRoutedSttProvider({
        savedProvider: "parakeet",
        platform: browser,
        route: routeOfflineSpeech("en", "sensevoice"),
        capabilities: capabilities(false),
      }),
    ).toEqual({
      provider: "parakeet",
      hasExplicitPreference: true,
      parakeetAvailable: false,
      languageMissing: true,
    });
  });

  it("runs a chosen Parakeet under Japanese without the language's set", () => {
    withWebSpeech();
    expect(
      resolveRoutedSttProvider({
        savedProvider: "parakeet",
        platform: browser,
        route: routeOfflineSpeech("ja", "parakeet"),
        capabilities: capabilities(false),
      }),
    ).toMatchObject({
      provider: "parakeet",
      parakeetAvailable: true,
      languageMissing: false,
    });
  });

  it("falls back as before under English when Parakeet is missing", () => {
    withWebSpeech();
    expect(
      resolveRoutedSttProvider({
        savedProvider: "parakeet",
        platform: browser,
        route: routeOfflineSpeech("en"),
        capabilities: capabilities(true, false),
      }),
    ).toEqual({
      provider: "browser_external",
      hasExplicitPreference: false,
      parakeetAvailable: false,
      languageMissing: false,
    });
  });
});
