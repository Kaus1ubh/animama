import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimaVoicesEditor } from "./VoiceLoadoutSection";

type PickerProps = {
  value: string;
  voices: readonly string[];
  modelId: string;
  sampleSource: (voice: string) => { id: string };
  onSelect: (voice: string) => Promise<void>;
};

const fixtures = vi.hoisted(() => ({
  update: vi.fn(async () => undefined),
  picker: null as PickerProps | null,
  speech: {} as Record<string, unknown>,
  loadSample: vi.fn(),
}));

// The picker's own behaviour is covered by its tests; this checks what the
// loadout gives it.
vi.mock("@/ui/animas/GeminiVoicePicker", () => ({
  GeminiVoicePicker: (props: PickerProps) => {
    fixtures.picker = props;
    return null;
  },
}));
vi.mock("@/lib/speech/gemini-voices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/speech/gemini-voices")>()),
  geminiVoiceSampleSource: (
    _client: unknown,
    modelId: string,
    voice: string,
  ) => ({
    id: voice,
    name: voice,
    loadSample: () => fixtures.loadSample(voice, modelId),
  }),
}));
vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({
    data: { revision: 1, voice_source: null },
    isError: false,
  }),
}));
vi.mock("@/query/hooks/useVoiceClones", () => ({
  useVoiceClones: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock("@/query/mutations/useVoiceSelection", () => ({
  useVoiceSelection: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: {
      gemini_tts: {
        models: ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"],
        default_model: "gemini-3.8-flash-lite-tts",
        voices: ["Kore", "Puck"],
        default_voice: "Kore",
      },
    },
  }),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    animaId: "anima-1",
    effectivePreferences: {
      speech: { tts_enabled: true, tts_provider: "gemini", ...fixtures.speech },
    },
    animaPreferences: { speech: { gemini: { voice: "NotAVoice" } } },
    updateAnimaPreferences: fixtures.update,
    isLoading: false,
    isUpdating: false,
  }),
}));
vi.mock("@/hooks/use-pocket-tts-runtime", () => ({
  usePocketTtsRuntime: () => ({
    hasCustomVoice: false,
    isEncodingVoice: false,
  }),
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: () => ({
    availability: () => null,
    install: vi.fn(),
    operatorManaged: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPicker(): PickerProps {
  renderToStaticMarkup(<AnimaVoicesEditor />);
  if (!fixtures.picker)
    throw new Error("the Gemini voice picker was not shown");
  return fixtures.picker;
}

describe("Gemini voice choice", () => {
  beforeEach(() => {
    fixtures.update.mockClear();
    fixtures.loadSample.mockClear();
    fixtures.picker = null;
    fixtures.speech = {};
  });

  it("shows the voice the backend will speak when the saved name is unknown", () => {
    const picker = renderPicker();
    expect(picker.value).toBe("Kore");
    expect(picker.voices).toEqual(["Kore", "Puck"]);
  });

  it("plays samples with the model replies are spoken with", () => {
    expect(renderPicker().modelId).toBe("gemini-3.8-flash-lite-tts");

    fixtures.speech = { tts_gemini_model_id: "gemini-3.8-flash-tts" };
    const picker = renderPicker();
    expect(picker.modelId).toBe("gemini-3.8-flash-tts");
    const sample = picker.sampleSource("Puck") as unknown as {
      loadSample: () => unknown;
    };
    sample.loadSample();
    expect(fixtures.loadSample).toHaveBeenCalledWith(
      "Puck",
      "gemini-3.8-flash-tts",
    );
  });

  it("saves the chosen prebuilt voice where the backend reads it", async () => {
    await renderPicker().onSelect("Puck");
    expect(fixtures.update).toHaveBeenCalledWith({
      speech: { gemini: { voice: "Puck" } },
    });
  });

  it("reports a failed save so the list stays open", async () => {
    fixtures.update.mockRejectedValueOnce(new Error("offline"));
    await expect(renderPicker().onSelect("Puck")).rejects.toThrow("offline");
  });
});
