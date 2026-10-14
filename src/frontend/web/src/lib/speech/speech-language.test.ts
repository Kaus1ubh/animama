import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import {
  browserSpeechLanguage,
  conversationLocale,
  speechEngineIsEnglishOnly,
} from "./speech-language";

describe("conversation language for speech (ADR 0024)", () => {
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("is the active UI Locale when it is not English", async () => {
    expect(conversationLocale()).toBeNull();
    expect(browserSpeechLanguage()).toBeUndefined();

    await getI18n().changeLanguage("zh-Hant");

    expect(conversationLocale()).toBe("zh-Hant");
    expect(browserSpeechLanguage()).toBe("zh-TW");
  });

  it("is absent under the pseudo-locale and for other tags", async () => {
    await getI18n().changeLanguage("en-XA");
    expect(conversationLocale()).toBeNull();
    expect(conversationLocale("fr")).toBeNull();
    expect(conversationLocale("toString")).toBeNull();
  });

  it("treats only Parakeet and Pocket TTS as English-only", () => {
    expect(speechEngineIsEnglishOnly("speechToText", "parakeet")).toBe(true);
    expect(speechEngineIsEnglishOnly("speechToText", "parakeet_webgpu")).toBe(
      true,
    );
    expect(speechEngineIsEnglishOnly("speechToText", "browser_external")).toBe(
      false,
    );
    expect(speechEngineIsEnglishOnly("textToSpeech", "pocket_tts")).toBe(true);
    for (const provider of ["elevenlabs", "gemini", "browser", null]) {
      expect(speechEngineIsEnglishOnly("textToSpeech", provider)).toBe(false);
    }
  });
});
