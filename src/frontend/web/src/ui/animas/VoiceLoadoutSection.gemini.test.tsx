import type { ReactNode } from "react";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimaVoicesEditor } from "./VoiceLoadoutSection";

const fixtures = vi.hoisted(() => ({
  update: vi.fn(async () => undefined),
  // Each rendered Select's change handler, in render order.
  selects: [] as Array<(value: string) => void>,
}));

// A plain Select stand-in that exposes each change handler to the test.
vi.mock("@/ui/components/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => {
    fixtures.selects.push(onValueChange);
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
      speech: { tts_enabled: true, tts_provider: "gemini" },
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

describe("Gemini voice choice", () => {
  beforeEach(() => {
    fixtures.update.mockClear();
    fixtures.selects.length = 0;
  });

  it("shows the voice the backend will speak when the saved name is unknown", () => {
    expect(renderToStaticMarkup(<AnimaVoicesEditor />)).toContain(
      "<span>Kore</span>",
    );
  });

  it("saves the chosen prebuilt voice where the backend reads it", async () => {
    renderToStaticMarkup(<AnimaVoicesEditor />);
    // The provider select renders first, then the Gemini voice select.
    const chooseVoice = fixtures.selects[1];
    expect(chooseVoice).toBeTypeOf("function");

    chooseVoice?.("Puck");

    await vi.waitFor(() =>
      expect(fixtures.update).toHaveBeenCalledWith({
        speech: { gemini: { voice: "Puck" } },
      }),
    );
  });
});
