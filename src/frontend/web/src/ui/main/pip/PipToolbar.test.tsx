// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopPipVoiceState } from "@/hooks/useDesktopPipVoice";
import { PIP_TOOLBAR_FIT, PipVoiceControls } from "./PipToolbar";

const idle: DesktopPipVoiceState = {
  activeMode: null,
  canStartVoice: true,
  isDictationPreparing: false,
  isMicCaptureActive: false,
  isUserSpeaking: false,
  isVoiceMicMuted: false,
};
const talking: DesktopPipVoiceState = {
  ...idle,
  activeMode: "voice",
  isMicCaptureActive: true,
  isUserSpeaking: true,
};

let container: HTMLDivElement;
let root: Root;
const onCommand = vi.fn();

function render(voice: DesktopPipVoiceState | null) {
  act(() =>
    root.render(<PipVoiceControls voice={voice} onCommand={onCommand} />),
  );
}

const buttons = () =>
  [...container.querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-label"),
  );

function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`no ${label} button`);
  act(() => button.click());
}

/** The waveform's bars, as the composer's synthetic waveform draws them. */
const bars = () => [
  ...container.querySelectorAll<HTMLSpanElement>("div[aria-hidden] > span"),
];

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  onCommand.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PiP voice controls", () => {
  it("show nothing until the main window reports its microphone", () => {
    render(null);
    expect(container.innerHTML).toBe("");
  });

  it("offer voice mode only when the main window can start it", () => {
    render(idle);
    expect(buttons()).toEqual(["Voice mode"]);
    click("Voice mode");
    expect(onCommand).toHaveBeenCalledWith("start-voice-mode");

    render({ ...idle, canStartVoice: false });
    expect(container.innerHTML).toBe("");
  });

  it("show the waveform, mute and stop during voice mode", () => {
    render(talking);
    expect(buttons()).toEqual(["Mute Mic", "Stop voice mode"]);
    click("Mute Mic");
    expect(onCommand).toHaveBeenLastCalledWith("toggle-voice-mute");
    click("Stop voice mode");
    expect(onCommand).toHaveBeenLastCalledWith("stop-mic-session");

    // A compact waveform: four bars that stay inside the 20 px toolbar.
    const waveform = container.querySelector("div[aria-hidden]");
    expect(waveform?.className).toContain(PIP_TOOLBAR_FIT.waveform);
    expect(bars()).toHaveLength(4);
    for (const bar of bars())
      expect(Number.parseFloat(bar.style.height)).toBeLessThanOrEqual(16);
    expect(bars().some((bar) => bar.style.animationName)).toBe(true);
  });

  it("mark a muted microphone and keep its waveform still", () => {
    render({ ...talking, isVoiceMicMuted: true });
    expect(buttons()).toEqual(["Unmute Mic", "Stop voice mode"]);
    const unmute = container.querySelector('button[aria-label="Unmute Mic"]');
    expect(unmute?.className).toContain("text-red-500");
    expect(bars().some((bar) => bar.style.animationName)).toBe(false);
  });

  it("only stop dictation the main window started", () => {
    render({ ...talking, activeMode: "dictation" });
    expect(buttons()).toEqual(["Stop dictation"]);
    click("Stop dictation");
    expect(onCommand).toHaveBeenLastCalledWith("stop-mic-session");

    render({ ...talking, activeMode: "dictation", isDictationPreparing: true });
    expect(bars()).toHaveLength(0);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});
