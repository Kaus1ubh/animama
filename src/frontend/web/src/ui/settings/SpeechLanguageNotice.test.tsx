import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { renderToStaticMarkup } from "@/test/runtime-markup";
import { SpeechLanguageNotice } from "@/ui/settings/SpeechLanguageNotice";

describe("speech language notice", () => {
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("suggests ElevenLabs or Gemini when Pocket TTS cannot speak the app's language", async () => {
    await getI18n().changeLanguage("ja");

    const markup = renderToStaticMarkup(
      <SpeechLanguageNotice direction="textToSpeech" provider="pocket_tts" />,
    );

    expect(markup).toContain("日本語");
    expect(markup).toContain("ElevenLabs");
    expect(markup).toContain("Gemini");
  });

  it("says Parakeet listens in English only", async () => {
    await getI18n().changeLanguage("ko");

    const markup = renderToStaticMarkup(
      <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
    );

    expect(markup).toContain("Parakeet");
    expect(markup).toContain("한국어");
  });

  it("shows nothing in English or for an engine that follows the language", async () => {
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="textToSpeech" provider="pocket_tts" />,
      ),
    ).toBe("");

    await getI18n().changeLanguage("zh-Hans");
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="textToSpeech" provider="gemini" />,
      ),
    ).toBe("");
  });
});
