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
      });
    }
  });

  it.each(["ja", "ko", "zh-Hans", "zh-Hant"])(
    "routes %s to SenseVoice in that language",
    (locale) => {
      expect(routeOfflineSpeech(locale)).toEqual({
        engine: "sensevoice",
        language: locale,
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
