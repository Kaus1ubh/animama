import { getI18n } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderToStaticMarkup } from "@/test/runtime-markup";
import { SpeechLanguageNotice } from "@/ui/settings/SpeechLanguageNotice";

const runtime = vi.hoisted(() => ({
  capabilities: undefined as Record<string, unknown> | undefined,
  downloadsEnded: false,
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: runtime.capabilities }),
}));
vi.mock("@/query/hooks/useModelDownloadsEnded", () => ({
  useModelDownloadsEnded: () => runtime.downloadsEnded,
}));

/** A local runtime with Parakeet and, optionally, SenseVoice installed. */
const local = (senseVoice: boolean) => ({
  local_filesystem_administration: true,
  offline_speech_enabled: true,
  offline_multilingual_speech_enabled: senseVoice,
});

describe("speech language notice", () => {
  beforeEach(() => {
    runtime.capabilities = local(false);
    runtime.downloadsEnded = false;
  });
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

  it.each(["parakeet", "parakeet_webgpu"])(
    "asks for the language's offline model when %s has none",
    async (provider) => {
      await getI18n().changeLanguage("ko");

      const markup = renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider={provider} />,
      );

      expect(markup).toContain("한국어");
      expect(markup).toContain(
        getI18n().t("voice:languageNotice.speechToText", {
          language: "한국어",
        }),
      );
      expect(markup).not.toContain("Parakeet");
    },
  );

  it.each([
    ["ja", "日本語"],
    ["zh-Hant", "繁體中文"],
  ])(
    "warns that a chosen Parakeet recognizes English only under %s",
    async (locale, language) => {
      runtime.capabilities = local(true);
      await getI18n().changeLanguage(locale);

      expect(
        renderToStaticMarkup(
          <SpeechLanguageNotice
            direction="speechToText"
            provider="parakeet"
            engine="parakeet"
          />,
        ),
      ).toContain(
        getI18n().t("voice:languageNotice.speechToTextEnglishOnly", {
          language,
        }),
      );
    },
  );

  it("asks for SenseVoice's model when it is chosen under English without its set", () => {
    const markup = renderToStaticMarkup(
      <SpeechLanguageNotice
        direction="speechToText"
        provider="parakeet"
        engine="sensevoice"
      />,
    );

    expect(markup).toContain(
      getI18n().t("voice:languageNotice.speechToTextModel"),
    );
    runtime.capabilities = local(true);
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice
          direction="speechToText"
          provider="parakeet"
          engine="sensevoice"
        />,
      ),
    ).toBe("");
  });

  it("says the language's model can no longer be downloaded once downloads have ended", async () => {
    runtime.downloadsEnded = true;
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice
          direction="speechToText"
          provider="parakeet"
          engine="sensevoice"
        />,
      ),
    ).toContain(getI18n().t("voice:languageNotice.speechToTextModelEnded"));
    await getI18n().changeLanguage("ko");
    const markup = renderToStaticMarkup(
      <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
    );
    expect(markup).toContain(
      getI18n().t("voice:languageNotice.speechToTextEnded", {
        language: "한국어",
      }),
    );
    expect(markup).not.toContain(
      getI18n().t("voice:languageNotice.speechToText", { language: "한국어" }),
    );
  });

  it("says when the operator does not provide the language's model", async () => {
    runtime.capabilities = {
      ...local(false),
      local_filesystem_administration: false,
    };
    await getI18n().changeLanguage("zh-Hant");

    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
      ),
    ).toContain(
      getI18n().t("voice:languageNotice.speechToTextUnavailable", {
        language: "繁體中文",
      }),
    );
  });

  it("does not ask for a download when the operator turned the installed set off", async () => {
    runtime.capabilities = {
      ...local(false),
      offline_multilingual_speech_asset_version: "fixture",
    };
    await getI18n().changeLanguage("ja");

    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
      ),
    ).toContain(
      getI18n().t("voice:languageNotice.speechToTextUnavailable", {
        language: "日本語",
      }),
    );
  });

  it("shows nothing once the language's offline model is installed", async () => {
    runtime.capabilities = local(true);
    await getI18n().changeLanguage("zh-Hans");

    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
      ),
    ).toBe("");
  });

  it("shows nothing in English, for the browser recognizers or while the runtime is unknown", async () => {
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="textToSpeech" provider="pocket_tts" />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
      ),
    ).toBe("");

    await getI18n().changeLanguage("zh-Hans");
    for (const markup of [
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="textToSpeech" provider="gemini" />,
      ),
      renderToStaticMarkup(
        <SpeechLanguageNotice
          direction="speechToText"
          provider="browser_external"
        />,
      ),
    ])
      expect(markup).toBe("");
    runtime.capabilities = undefined;
    expect(
      renderToStaticMarkup(
        <SpeechLanguageNotice direction="speechToText" provider="parakeet" />,
      ),
    ).toBe("");
  });
});
