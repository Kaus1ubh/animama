// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDLE_VOICE_SAMPLE,
  type VoiceSampleSource,
} from "@/lib/speech/pocket/voice-sample-player";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { GEMINI_SAMPLE_NOTE, GeminiVoiceList } from "./GeminiVoicePicker";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const loadSample = vi.fn(async () => new Blob());
const source = (voice: string): VoiceSampleSource => ({
  id: voice,
  name: voice,
  loadSample,
});

function list(overrides: Partial<Parameters<typeof GeminiVoiceList>[0]> = {}) {
  return (
    <GeminiVoiceList
      value="Kore"
      voices={["Kore", "Puck", "Leda"]}
      modelId="gemini-3.8-flash-lite-tts"
      disabled={false}
      sampleSource={source}
      onSelect={async () => undefined}
      onSelected={() => undefined}
      sample={IDLE_VOICE_SAMPLE}
      player={{ play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }}
      {...overrides}
    />
  );
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Gemini voice list", () => {
  it("lists each voice with its description, a sample button and the gender tabs", () => {
    const html = renderToStaticMarkup(list());

    for (const tab of ["All", "Female", "Male"])
      expect(html).toContain(`>${tab}</button>`);
    expect(html).toContain("3 voices");
    expect(html).toMatch(
      /<button[^>]*aria-label="Select Kore"[^>]*aria-pressed="true"/,
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Select Puck"[^>]*aria-pressed="false"/,
    );
    expect(html).toContain(">Upbeat</p>");
    expect(html).toContain('aria-label="Play Leda sample"');
    expect(html).toContain(GEMINI_SAMPLE_NOTE);
  });

  it("says when no voice matches", () => {
    const html = renderToStaticMarkup(list({ voices: [] }));
    expect(html).toContain("0 voices");
    expect(html).toContain("No voices match these filters.");
  });

  it("plays a row's sample and saves a chosen voice", async () => {
    const player = { play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
    const onSelect = vi.fn(async () => undefined);
    const onSelected = vi.fn();
    const view = mount(list({ player, onSelect, onSelected }));

    act(() =>
      view
        .querySelector<HTMLButtonElement>('[aria-label="Play Puck sample"]')!
        .click(),
    );
    expect(player.play).toHaveBeenCalledWith(
      expect.objectContaining({ id: "Puck" }),
    );

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('[aria-label="Select Leda"]')!
        .click(),
    );
    expect(onSelect).toHaveBeenCalledWith("Leda");
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it("stays open when a choice is not saved", async () => {
    const onSelected = vi.fn();
    const view = mount(
      list({
        onSelect: async () => {
          throw new Error("not saved");
        },
        onSelected,
      }),
    );

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('[aria-label="Select Puck"]')!
        .click(),
    );
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("shows why a sample could not play", () => {
    const html = renderToStaticMarkup(
      list({
        sample: {
          voiceId: "Puck",
          status: "error",
          error: "Gemini text-to-speech needs a Gemini API key.",
        },
      }),
    );
    expect(html).toMatch(
      /role="alert"[^>]*>Gemini text-to-speech needs a Gemini API key\.</,
    );
  });
});
