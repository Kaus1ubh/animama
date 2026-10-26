import { describe, expect, it } from "vitest";

import {
  offlineLanguageMissing,
  offlineSpeechAvailable,
  routeOfflineSpeech,
} from "./routing";

describe("routeOfflineSpeech", () => {
  it("routes English, the pseudo-locale and unknown tags to Parakeet", () => {
    for (const locale of ["en", "en-XA", "fr", null]) {
      expect(routeOfflineSpeech(locale)).toEqual({
        engine: "parakeet",
        language: "en",
        browserFallback: true,
      });
    }
  });

  it.each(["ja", "ko", "zh-Hans", "zh-Hant"])(
    "routes %s to SenseVoice in that language",
    (locale) => {
      expect(routeOfflineSpeech(locale)).toEqual({
        engine: "sensevoice",
        language: locale,
        browserFallback: false,
      });
      expect(routeOfflineSpeech(locale, null)).toEqual(
        routeOfflineSpeech(locale),
      );
    },
  );

  it("runs a chosen SenseVoice under English with language detection", () => {
    for (const locale of ["en", "en-XA", null]) {
      expect(routeOfflineSpeech(locale, "sensevoice")).toEqual({
        engine: "sensevoice",
        language: "auto",
        browserFallback: false,
      });
    }
    // Under a supported language a SenseVoice choice keeps its prompt.
    expect(routeOfflineSpeech("ko", "sensevoice")).toEqual({
      engine: "sensevoice",
      language: "ko",
      browserFallback: false,
    });
  });

  it.each([
    ["en", true],
    ["ja", false],
    ["zh-Hant", false],
  ])(
    "runs a chosen Parakeet in English under %s",
    (locale, browserFallback) => {
      expect(routeOfflineSpeech(locale, "parakeet")).toEqual({
        engine: "parakeet",
        language: "en",
        browserFallback,
      });
    },
  );
});

describe("offlineSpeechAvailable", () => {
  const capabilities = {
    offline_speech_enabled: true,
    offline_multilingual_speech_enabled: false,
  };

  it("checks the routed engine's own installed sets", () => {
    expect(offlineSpeechAvailable(routeOfflineSpeech("en"), capabilities)).toBe(
      true,
    );
    expect(offlineSpeechAvailable(routeOfflineSpeech("ja"), capabilities)).toBe(
      false,
    );
    expect(
      offlineSpeechAvailable(routeOfflineSpeech("ko"), {
        offline_speech_enabled: false,
        offline_multilingual_speech_enabled: true,
      }),
    ).toBe(true);
  });

  it("treats an adapter without the multilingual field as unavailable", () => {
    expect(
      offlineSpeechAvailable(routeOfflineSpeech("zh-Hant"), {
        offline_speech_enabled: true,
      }),
    ).toBe(false);
  });
});

describe("offlineLanguageMissing", () => {
  const parakeetOnly = {
    offline_speech_enabled: true,
    offline_multilingual_speech_enabled: false,
  };

  it("stops a saved offline choice when the language's set is missing", () => {
    expect(
      offlineLanguageMissing(
        "parakeet",
        routeOfflineSpeech("ja"),
        parakeetOnly,
      ),
    ).toBe(true);
  });

  it("stops a chosen SenseVoice under English when its set is missing", () => {
    expect(
      offlineLanguageMissing(
        "parakeet",
        routeOfflineSpeech("en", "sensevoice"),
        parakeetOnly,
      ),
    ).toBe(true);
  });

  it("stops a chosen Parakeet under another language instead of falling back", () => {
    expect(
      offlineLanguageMissing("parakeet", routeOfflineSpeech("ja", "parakeet"), {
        offline_speech_enabled: false,
        offline_multilingual_speech_enabled: true,
      }),
    ).toBe(true);
  });

  it("leaves other choices, English and installed sets to provider resolution", () => {
    expect(
      offlineLanguageMissing(
        "browser_external",
        routeOfflineSpeech("ja"),
        parakeetOnly,
      ),
    ).toBe(false);
    expect(
      offlineLanguageMissing(null, routeOfflineSpeech("ja"), parakeetOnly),
    ).toBe(false);
    expect(
      offlineLanguageMissing("parakeet", routeOfflineSpeech("en"), {
        offline_speech_enabled: false,
      }),
    ).toBe(false);
    expect(
      offlineLanguageMissing("parakeet", routeOfflineSpeech("ko"), {
        offline_speech_enabled: false,
        offline_multilingual_speech_enabled: true,
      }),
    ).toBe(false);
  });
});
