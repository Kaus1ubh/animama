import { beforeEach, describe, expect, it, vi } from "vitest";

const { core } = vi.hoisted(() => ({
  core: {
    init: vi.fn(async () => undefined),
    setVoice: vi.fn(),
    generate: vi.fn(async () => ({ generationId: "generation" })),
    getStatus: () => ({ phase: "ready", generationId: null }),
    getMetrics: () => ({}),
    getVoices: () => ["eve", "azelma"],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    preloadAnimaVoices:
      vi.fn<
        (reference: string) => Promise<{ available: boolean; voices: string[] }>
      >(),
  },
}));

vi.mock("@/lib/speech/pocket/createPocketTTS", () => ({
  createPocketTTS: () => core,
}));
vi.mock("@/lib/speech/tts-provider", () => ({
  isPocketTtsSupported: () => true,
}));

describe("mounted Pocket voice generation", () => {
  beforeEach(() => {
    vi.resetModules();
    core.preloadAnimaVoices.mockResolvedValue({
      available: true,
      voices: ["neutral"],
    });
  });

  it.each([
    { available: false, voices: [] },
    { available: true, voices: ["happy_1"] },
  ])(
    "refuses another voice when the selected catalog is unavailable: %j",
    async (catalog) => {
      core.preloadAnimaVoices.mockResolvedValue(catalog);
      const { generatePocketTtsText } =
        await import("./use-pocket-tts-runtime");
      await expect(
        generatePocketTtsText("Hello", {
          animaId: "clone-a-reference",
          assertAnimaCatalogActive: () => undefined,
        }),
      ).rejects.toThrow("selected PocketTTS voice");
      expect(core.generate).not.toHaveBeenCalled();
    },
  );

  it("rejects a mount disposed while its catalog preloads", async () => {
    let active = true;
    core.preloadAnimaVoices.mockImplementationOnce(async () => {
      active = false;
      return { available: true, voices: ["neutral"] };
    });
    const { generatePocketTtsText } = await import("./use-pocket-tts-runtime");
    await expect(
      generatePocketTtsText("Hello", {
        animaId: "clone-a-reference",
        assertAnimaCatalogActive: () => {
          if (!active) throw new Error("Voice mount ended.");
        },
      }),
    ).rejects.toThrow("Voice mount ended");
    expect(core.generate).not.toHaveBeenCalled();
  });

  it("loads each selected clone reference and leaves a subsequent preset free of catalog state", async () => {
    const { generatePocketTtsText } = await import("./use-pocket-tts-runtime");
    for (const animaId of ["clone-a-reference", "clone-b-reference"]) {
      await generatePocketTtsText("Hello", {
        animaId,
        animaVoiceKey: "neutral",
        assertAnimaCatalogActive: () => undefined,
      });
    }
    await generatePocketTtsText("Hello again", { voice: "eve" });
    expect(core.preloadAnimaVoices.mock.calls).toEqual([
      ["clone-a-reference"],
      ["clone-b-reference"],
    ]);
    expect(core.generate.mock.calls).toEqual([
      ["Hello", { animaId: "clone-a-reference", animaVoiceKey: "neutral" }],
      ["Hello", { animaId: "clone-b-reference", animaVoiceKey: "neutral" }],
      ["Hello again", { voice: "eve" }],
    ]);
  });
});
