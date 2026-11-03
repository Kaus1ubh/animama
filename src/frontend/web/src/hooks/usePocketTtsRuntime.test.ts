import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

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
    stop: vi.fn(),
    endPlaybackStream: vi.fn(),
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

  it("does not restore private voice state from an ended core callback", async () => {
    const runtime = await import("./usePocketTtsRuntime");
    const { renderToStaticMarkup } = await import("@/test/runtime-markup");
    await runtime.generatePocketTtsText(testApiClient, "Hello", {
      voice: "eve",
    });
    const encoded = core.addEventListener.mock.calls.find(
      ([event]) => event === "voice_encoded",
    )![1];
    runtime.disposePocketTtsRuntime();
    encoded({ detail: { voiceName: "private-ended-voice" } });
    function Probe() {
      return createElement(
        "span",
        null,
        runtime.usePocketTtsRuntime().currentVoice,
      );
    }
    expect(renderToStaticMarkup(createElement(Probe))).not.toContain(
      "private-ended-voice",
    );
  });

  it.each([
    { available: false, voices: [] },
    { available: true, voices: ["happy_1"] },
  ])(
    "refuses another voice when the selected catalog is unavailable: %j",
    async (catalog) => {
      core.preloadAnimaVoices.mockResolvedValue(catalog);
      const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
      await expect(
        generatePocketTtsText(testApiClient, "Hello", {
          animaId: "clone-a-reference",
          assertAnimaCatalogActive: () => undefined,
        }),
      ).rejects.toThrow("selected PocketTTS voice");
      expect(core.generate).not.toHaveBeenCalled();
    },
  );

  it("counts model setup steps from the worker's status texts", async () => {
    let finish!: () => void;
    core.init.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    const runtime = await import("./usePocketTtsRuntime");
    const { renderToStaticMarkup } = await import("@/test/runtime-markup");
    const warmup = runtime.warmupPocketTtsRuntime(testApiClient);
    const status = core.addEventListener.mock.calls.findLast(
      ([event]) => event === "model_status",
    )![1];
    function Probe() {
      return createElement(
        "span",
        null,
        String(runtime.usePocketTtsRuntime().loadingStep),
      );
    }
    const step = () => renderToStaticMarkup(createElement(Probe));
    expect(step()).toBe("<span>null</span>");
    status({ detail: { status: "loading", text: "Loading ONNX sessions..." } });
    expect(step()).toBe("<span>3</span>");
    // The cloning encoder is not a model setup step.
    status({ detail: { status: "loading", text: "Loading voice encoder..." } });
    expect(step()).toBe("<span>3</span>");
    finish();
    await warmup;
    expect(step()).toBe("<span>null</span>");
    expect(runtime.POCKET_LOADING_STEP_COUNT).toBe(5);
  });

  it("rejects a mount disposed while its catalog preloads", async () => {
    let active = true;
    core.preloadAnimaVoices.mockImplementationOnce(async () => {
      active = false;
      return { available: true, voices: ["neutral"] };
    });
    const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
    await expect(
      generatePocketTtsText(testApiClient, "Hello", {
        animaId: "clone-a-reference",
        assertAnimaCatalogActive: () => {
          if (!active) throw new Error("Voice mount ended.");
        },
      }),
    ).rejects.toThrow("Voice mount ended");
    expect(core.generate).not.toHaveBeenCalled();
  });

  it("loads each selected clone reference and leaves a subsequent preset free of catalog state", async () => {
    const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
    for (const animaId of ["clone-a-reference", "clone-b-reference"]) {
      await generatePocketTtsText(testApiClient, "Hello", {
        animaId,
        animaVoiceKey: "neutral",
        assertAnimaCatalogActive: () => undefined,
      });
    }
    await generatePocketTtsText(testApiClient, "Hello again", { voice: "eve" });
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

  it("speaks numbers and symbols as words and leaves out tags and emoji", async () => {
    const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
    await generatePocketTtsText(
      testApiClient,
      "[laughs] It costs $5.99 at 3:30 pm 😊",
      { voice: "eve" },
    );
    expect(core.generate.mock.calls).toEqual([
      [
        "It costs five dollars ninety-nine cents at three thirty P M",
        { voice: "eve" },
      ],
    ]);
  });

  it("skips text that has nothing left to say", async () => {
    const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
    await generatePocketTtsText(testApiClient, "😊 [laughs]", { voice: "eve" });
    expect(core.generate).not.toHaveBeenCalled();
  });

  it("still ends the stream when a final chunk has nothing to say", async () => {
    const { generatePocketTtsText } = await import("./usePocketTtsRuntime");
    await generatePocketTtsText(testApiClient, "Hello there.", {
      voice: "eve",
    });
    core.endPlaybackStream.mockClear();
    await generatePocketTtsText(testApiClient, "😊", {
      voice: "eve",
      endStream: true,
    });
    expect(core.generate).toHaveBeenCalledTimes(1);
    expect(core.endPlaybackStream).toHaveBeenCalledTimes(1);
  });
});
