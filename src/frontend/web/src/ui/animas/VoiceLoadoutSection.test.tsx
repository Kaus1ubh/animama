import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimaVoicesEditor } from "./VoiceLoadoutSection";
import { filteredPocketVoices, PocketVoiceList } from "./PocketVoicePicker";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";
import { voiceCloneSampleSource } from "@/lib/speech/pocket/voice-clones";
import { IDLE_VOICE_SAMPLE } from "@/lib/speech/pocket/voice-sample-player";

const fixtures = vi.hoisted(() => ({
  animaProvider: undefined as string | undefined,
  speech: {
    tts_enabled: false,
    tts_provider: "browser" as string | null,
    tts_pocket_anima_voice: "eve",
    elevenlabs: { primary_voice: { voice_id: "saved-voice" } },
  },
  warmup: vi.fn(),
  setVoice: vi.fn(),
  update: vi.fn(),
  selectedCloneId: null as string | null,
  clones: [] as PyVoiceContent[],
}));
vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({
    data: {
      revision: 1,
      voice_source: fixtures.selectedCloneId
        ? { catalog_item_id: fixtures.selectedCloneId }
        : null,
    },
    isError: false,
  }),
}));
vi.mock("@/query/hooks/useVoiceClones", () => ({
  useVoiceClones: () => ({
    data: fixtures.clones,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/query/mutations/useVoiceSelection", () => ({
  useVoiceSelection: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/query/mutations/useVoiceCloneActions", () => ({
  useVoiceCloneActions: () => ({
    saveVoiceClone: { mutateAsync: vi.fn() },
    renameVoiceClone: { mutateAsync: vi.fn() },
    deleteVoiceClone: { mutateAsync: vi.fn() },
  }),
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
    fixtures.selectedCloneId = null;
    fixtures.clones = [];
  });
  it.each([
    ["pocket_tts", false],
    ["pocket_tts", true],
    ["elevenlabs", false],
    ["elevenlabs", true],
  ] as const)(
    "shows only %s controls with TTS enabled=%s",
    (provider, enabled) => {
      fixtures.speech.tts_provider = provider;
      fixtures.speech.tts_enabled = enabled;
      const html = renderToStaticMarkup(<AnimaVoicesEditor />);
      expect(html).toContain('aria-label="TTS Provider"');
      if (provider === "pocket_tts") {
        expect(html).toContain('aria-label="PocketTTS voice: Eve"');
        expect(html).toContain('aria-label="Play Eve sample"');
        expect(html).toContain(">Voice Cloning</h3>");
        expect(html.indexOf(">Voice Cloning</h3>")).toBeLessThan(
          html.indexOf(">Upload voice sample</button>"),
        );
        expect(html).not.toContain('aria-label="ElevenLabs voice"');
        expect(html).not.toMatch(
          /<button[^>]* disabled=""[^>]*aria-label="PocketTTS voice/,
        );
      } else {
        expect(html).toContain('value="saved-voice"');
        expect(html).not.toContain('aria-label="PocketTTS voice"');
        expect(html).not.toContain("Voice Cloning");
        expect(html).not.toMatch(
          /<input[^>]*id="anima-elevenlabs-voice"[^>]* disabled=""/,
        );
      }
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

  it("shows a selected named clone and its sample instead of the fallback preset", () => {
    fixtures.speech.tts_provider = "pocket_tts";
    fixtures.clones = [
      {
        item_id: "voice-1",
        name: "Storyteller",
        codec: "pocket-tts-catalog-v1",
        files: [
          { role: "source_sample", file_ref: "sample-ref", size_bytes: 10 },
        ],
      } as PyVoiceContent,
      { item_id: "voice-2", name: "Narrator" } as PyVoiceContent,
    ];
    fixtures.selectedCloneId = "voice-1";
    const html = renderToStaticMarkup(<AnimaVoicesEditor />);
    expect(html).toContain('aria-label="PocketTTS voice: Storyteller"');
    expect(html).toContain('aria-label="Play Storyteller sample"');
    expect(html).toContain('aria-label="Delete Storyteller"');
    expect(html.indexOf('aria-label="Play Storyteller sample"')).toBeLessThan(
      html.indexOf('aria-label="Delete Storyteller"'),
    );
    expect(html).not.toContain('aria-label="Use Narrator"');
    expect(html).not.toContain("Original samples are retained.");
    expect(html).not.toContain("New voice name");
    expect(html).toContain("Clone voice");
    expect(html).not.toContain('aria-label="PocketTTS voice: Eve"');
  });

  it("keeps an imported clone selected while disabling only its original recording preview", () => {
    fixtures.speech.tts_provider = "pocket_tts";
    const clone = {
      item_id: "imported-voice",
      name: "Imported Narrator",
      codec: "pocket-tts-catalog-v1",
      files: [
        {
          role: "pocket_voice_catalog",
          file_ref: "catalog-ref",
          size_bytes: 10,
        },
      ],
    } as PyVoiceContent;
    fixtures.clones = [clone];
    fixtures.selectedCloneId = clone.item_id;
    const selected = renderToStaticMarkup(<AnimaVoicesEditor />);
    expect(selected).toContain(
      'aria-label="PocketTTS voice: Imported Narrator"',
    );
    expect(selected).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Imported Narrator: Original recording unavailable"/,
    );
    expect(selected).not.toContain(
      'aria-label="Play Imported Narrator sample"',
    );
    expect(selected).toContain(">Original recording unavailable</p>");
    expect(selected).toContain('aria-label="Delete Imported Narrator"');
    const list = renderToStaticMarkup(
      <PocketVoiceList
        value="clone:imported-voice"
        disabled={false}
        hasCustomVoice={false}
        onSelect={async () => undefined}
        clones={[voiceCloneSampleSource(clone)]}
        availability={() => null}
        onDownload={() => undefined}
        onSelected={() => undefined}
        sample={IDLE_VOICE_SAMPLE}
        player={{ play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }}
      />,
    );
    expect(list).toMatch(
      /<button[^>]*aria-label="Select Imported Narrator"[^>]*aria-pressed="true"/,
    );
    expect(list).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Select Imported Narrator"/,
    );
    expect(list).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Imported Narrator: Original recording unavailable"/,
    );
  });

  it("labels an unavailable binding honestly while keeping preset selection available", () => {
    fixtures.speech.tts_provider = "pocket_tts";
    fixtures.selectedCloneId = "missing";
    const html = renderToStaticMarkup(<AnimaVoicesEditor />);
    expect(html).toContain(
      'aria-label="PocketTTS voice: Saved voice unavailable"',
    );
    expect(html).toContain("Choose another voice.");
    expect(html).not.toMatch(
      /<button[^>]* disabled=""[^>]*aria-label="PocketTTS voice/,
    );
  });

  it.each(["browser", null])(
    "waits for a supported provider choice when the configured provider is %s",
    (provider) => {
      fixtures.speech.tts_provider = provider;
      const html = renderToStaticMarkup(<AnimaVoicesEditor />);
      expect(html).toContain('aria-label="TTS Provider"');
      expect(html).not.toContain('aria-label="PocketTTS voice"');
      expect(html).not.toContain('aria-label="ElevenLabs voice"');
      expect(html).not.toContain("Voice Cloning");
      expect(fixtures.update).not.toHaveBeenCalled();
    },
  );

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
        clones={[
          { id: "clone:one", name: "Narrator", previewUrl: "/sample.wav" },
        ]}
        onDeleteClone={() => undefined}
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
    expect(html.indexOf('aria-label="Play Narrator sample"')).toBeLessThan(
      html.indexOf('aria-label="Delete Narrator"'),
    );
    expect(html).not.toContain('aria-label="Delete Eve"');
    expect(html).not.toContain("Samples are source recordings");
    expect(html).not.toContain("Sample sources");
    expect(html).not.toContain("Use application default");
  });
});
