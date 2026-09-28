import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimaVoicesEditor } from "./VoiceLoadoutSection";
import { filteredPocketVoices, PocketVoiceList } from "./PocketVoicePicker";
import { IDLE_VOICE_SAMPLE } from "@/lib/speech/pocket/voice-sample-player";

const fixtures = vi.hoisted(() => ({
  animaProvider: undefined as string | undefined,
  speech: {
    tts_enabled: false,
    tts_provider: "browser",
    tts_pocket_anima_voice: "eve",
    elevenlabs: { primary_voice: { voice_id: "saved-voice" } },
  },
  warmup: vi.fn(),
  setVoice: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    animaId: "anima-1",
    effectivePreferences: { speech: fixtures.speech },
    animaPreferences: {
      speech: { ...fixtures.speech, tts_provider: fixtures.animaProvider },
    },
    updateAnimaPreferences: fixtures.update,
    isLoading: false,
    isUpdating: false,
  }),
}));
vi.mock("@/hooks/use-pocket-tts-runtime", () => ({
  usePocketTtsRuntime: () => ({
    hasCustomVoice: false,
    isEncodingVoice: false,
    warmup: fixtures.warmup,
    setVoice: fixtures.setVoice,
  }),
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: () => ({
    availability: () => null,
    install: vi.fn(),
  }),
}));
vi.mock("@/ui/app/AppShell", () => ({ useOptionalAppShell: () => null }));

describe("Anima voice configuration", () => {
  beforeEach(() => {
    fixtures.speech.tts_enabled = false;
    fixtures.speech.tts_provider = "browser";
    fixtures.animaProvider = undefined;
  });
  it.each(["browser", "pocket_tts", "elevenlabs"])(
    "keeps both voice controls editable with %s selected and TTS disabled",
    (provider) => {
      fixtures.speech.tts_provider = provider;
      const html = renderToStaticMarkup(<AnimaVoicesEditor />);
      expect(html).toContain('aria-label="TTS Provider"');
      expect(html).toContain('aria-label="PocketTTS voice: Eve"');
      expect(html).toContain('aria-label="Play Eve sample"');
      expect(html).toContain('value="saved-voice"');
      expect(html).not.toMatch(
        /<input[^>]*id="anima-elevenlabs-voice"[^>]* disabled=""/,
      );
      expect(html).not.toMatch(
        /<button[^>]* disabled=""[^>]*aria-label="PocketTTS voice/,
      );
      expect(html).not.toContain("Use application default");
      expect(html).not.toContain("PocketTTS status");
      expect(fixtures.warmup).not.toHaveBeenCalled();
      expect(fixtures.setVoice).not.toHaveBeenCalled();
      expect(fixtures.update).not.toHaveBeenCalled();
    },
  );

  it("displays inherited Browser TTS without choosing a replacement", () => {
    const html = renderToStaticMarkup(<AnimaVoicesEditor />);
    expect(html).toContain("Browser (app)");
    expect(html).toContain("Speech is off in application settings.");
    expect(fixtures.update).not.toHaveBeenCalled();
  });

  it("displays an explicit provider without marking it as inherited", () => {
    fixtures.animaProvider = "elevenlabs";
    fixtures.speech.tts_provider = "elevenlabs";
    const html = renderToStaticMarkup(<AnimaVoicesEditor />);
    expect(html).toContain("ElevenLabs</span>");
    expect(html).not.toContain("ElevenLabs (app)");
  });

  it("combines voice gender, recommendation and accent/name filters", () => {
    const all = filteredPocketVoices({
      gender: "any",
      recommended: false,
      search: "",
    });
    expect(all).toHaveLength(38);
    const female = filteredPocketVoices({
      gender: "female",
      recommended: true,
      search: "Canadian",
    });
    expect(female.map((voice) => voice.id)).toEqual(["azelma"]);
    const male = filteredPocketVoices({
      gender: "male",
      recommended: true,
      search: "",
    });
    expect(male.length).toBeGreaterThan(0);
    expect(
      male.every((voice) => voice.gender === "male" && voice.recommended),
    ).toBe(true);
    expect(
      filteredPocketVoices({
        gender: "any",
        recommended: false,
        search: " EVE ",
      }).map((voice) => voice.id),
    ).toEqual(["eve"]);
  });

  it("offers each sample before an independent download action without a default row", () => {
    const html = renderToStaticMarkup(
      <PocketVoiceList
        value="eve"
        disabled={false}
        hasCustomVoice={false}
        onSelect={async () => undefined}
        availability={(id) =>
          id === "anna"
            ? { assetId: "pocket-voice-anna", status: "not_installed" }
            : null
        }
        onDownload={() => undefined}
        onSelected={() => undefined}
        sample={IDLE_VOICE_SAMPLE}
        player={{ play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }}
      />,
    );
    expect(html.indexOf('aria-label="Play Anna sample"')).toBeLessThan(
      html.indexOf('aria-label="Download Anna"'),
    );
    expect(html).not.toContain("Samples are source recordings");
    expect(html).not.toContain("Sample sources");
    expect(html).not.toContain("Use application default");
  });
});
