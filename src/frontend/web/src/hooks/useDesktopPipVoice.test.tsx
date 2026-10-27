// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isDesktopPipVoiceCommand,
  isDesktopPipVoiceState,
  useDesktopPipVoiceConsumer,
  useDesktopPipVoiceOwner,
  type DesktopPipVoiceCommand,
  type DesktopPipVoiceHandlers,
  type DesktopPipVoiceState,
} from "./useDesktopPipVoice";

type RuntimeListener = (message: DesktopPipRuntimeMessage) => void;
type StateListener = (state: DesktopPipState) => void;

const bridge = vi.hoisted(() => ({
  runtimeListeners: new Set<RuntimeListener>(),
  stateListeners: new Set<StateListener>(),
  initialState: null as Promise<DesktopPipState> | null,
  published: [] as DesktopPipRuntimeMessage[],
}));

// The provider hands out one stable platform object, as the app's does.
const platform = vi.hoisted(() => ({
  kind: "desktop",
  capabilities: { nativePiP: true },
  desktopBridge: {
    windowRole: "main",
    pip: {
      getState: () => bridge.initialState,
      onStateChange: (listener: StateListener) => {
        bridge.stateListeners.add(listener);
        return () => bridge.stateListeners.delete(listener);
      },
      onRuntimeMessage: (listener: RuntimeListener) => {
        bridge.runtimeListeners.add(listener);
        return () => bridge.runtimeListeners.delete(listener);
      },
      publishRuntimeMessage: async (message: DesktopPipRuntimeMessage) => {
        bridge.published.push(message);
      },
    },
  },
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => platform,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ animaId: "annie" }),
}));

const idle: DesktopPipVoiceState = {
  activeMode: null,
  canStartVoice: true,
  isDictationPreparing: false,
  isMicCaptureActive: false,
  isUserSpeaking: false,
  isVoiceMicMuted: false,
};
const speaking: DesktopPipVoiceState = {
  ...idle,
  activeMode: "voice",
  isMicCaptureActive: true,
  isUserSpeaking: true,
};

function pipState(isOpen: boolean, animaId = "annie"): DesktopPipState {
  return {
    isOpen,
    animaId,
    chatId: null,
    backgroundMode: "transparent",
    isHovered: false,
    sizeScale: 0.5,
  };
}

function message(
  type: DesktopPipRuntimeMessage["type"],
  payload: unknown,
  { animaId = "annie", sequence = 0 } = {},
): DesktopPipRuntimeMessage {
  return { type, sequence, sentAtMs: 1, animaId, payload };
}

let container: HTMLDivElement;
let root: Root;

function deliver(runtime: DesktopPipRuntimeMessage) {
  act(() => {
    for (const listener of bridge.runtimeListeners) listener(runtime);
  });
}

function openPip(isOpen: boolean, animaId?: string) {
  act(() => {
    for (const listener of bridge.stateListeners)
      listener(pipState(isOpen, animaId));
  });
}

const published = (type: DesktopPipRuntimeMessage["type"]) =>
  bridge.published.filter((entry) => entry.type === type);

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  bridge.runtimeListeners.clear();
  bridge.stateListeners.clear();
  bridge.published.length = 0;
  bridge.initialState = Promise.resolve(pipState(false));
  platform.desktopBridge.windowRole = "main";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PiP voice messages", () => {
  it("accept only a complete voice state", () => {
    expect(isDesktopPipVoiceState(idle)).toBe(true);
    expect(isDesktopPipVoiceState(speaking)).toBe(true);
    expect(isDesktopPipVoiceState({ ...idle, activeMode: "phone" })).toBe(
      false,
    );
    const { canStartVoice: _, ...partial } = idle;
    expect(isDesktopPipVoiceState(partial)).toBe(false);
    expect(isDesktopPipVoiceState(null)).toBe(false);
  });

  it("accept only the three voice commands", () => {
    for (const command of [
      "start-voice-mode",
      "stop-mic-session",
      "toggle-voice-mute",
    ])
      expect(isDesktopPipVoiceCommand(command)).toBe(true);
    for (const command of ["start-dictation", "toString", "__proto__", 1])
      expect(isDesktopPipVoiceCommand(command)).toBe(false);
  });
});

describe("useDesktopPipVoiceOwner", () => {
  const handlers = {
    startVoiceMode: vi.fn(),
    stopMicSession: vi.fn(),
    toggleVoiceMute: vi.fn(),
  } satisfies DesktopPipVoiceHandlers;

  function Owner({ voice }: { voice: DesktopPipVoiceState }) {
    useDesktopPipVoiceOwner({ animaId: "annie", handlers, voice });
    return null;
  }

  async function mount(voice: DesktopPipVoiceState) {
    await act(async () => root.render(<Owner voice={voice} />));
  }

  beforeEach(() => {
    for (const handler of Object.values(handlers)) handler.mockClear();
  });

  it("sends nothing while PiP is closed, then the latest state once it opens", async () => {
    await mount(idle);
    await mount(speaking);
    expect(published("voice")).toHaveLength(0);

    openPip(true, "other");
    expect(published("voice")).toHaveLength(0);
    openPip(true);
    expect(published("voice").at(-1)?.payload).toEqual(speaking);
  });

  it("follows the main window's changes and answers PiP's readiness", async () => {
    bridge.initialState = Promise.resolve(pipState(true));
    await mount(idle);
    expect(published("voice").at(-1)?.payload).toEqual(idle);

    await mount(speaking);
    expect(published("voice").at(-1)?.payload).toEqual(speaking);

    const count = published("voice").length;
    deliver(message("ready", { kind: "ready" }));
    expect(published("voice")).toHaveLength(count + 1);
    expect(published("voice").at(-1)?.payload).toEqual(speaking);
    // Each state carries a newer sequence than the last.
    const sequences = published("voice").map((entry) => entry.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it("keeps a PiP state change that arrives before the initial state", async () => {
    let resolveInitial: (state: DesktopPipState) => void = () => {};
    bridge.initialState = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    await mount(speaking);
    openPip(true);
    await act(async () => resolveInitial(pipState(false)));
    await mount({ ...speaking, isVoiceMicMuted: true });
    expect(published("voice").at(-1)?.payload).toMatchObject({
      isVoiceMicMuted: true,
    });
  });

  it("runs the three voice commands PiP sends for this Anima", async () => {
    await mount(idle);
    const command = (value: unknown, animaId?: string) =>
      deliver(message("voice-command", { command: value }, { animaId }));

    command("start-voice-mode");
    command("toggle-voice-mute");
    command("stop-mic-session");
    expect(handlers.startVoiceMode).toHaveBeenCalledOnce();
    expect(handlers.toggleVoiceMute).toHaveBeenCalledOnce();
    expect(handlers.stopMicSession).toHaveBeenCalledOnce();

    command("start-dictation");
    command("toString");
    command("start-voice-mode", "other");
    deliver(message("camera-preset", { command: "start-voice-mode" }));
    expect(handlers.startVoiceMode).toHaveBeenCalledOnce();
  });

  it("stays idle inside the PiP window", async () => {
    platform.desktopBridge.windowRole = "pip";
    bridge.initialState = Promise.resolve(pipState(true));
    await mount(speaking);
    deliver(message("voice-command", { command: "start-voice-mode" }));
    expect(published("voice")).toHaveLength(0);
    expect(handlers.startVoiceMode).not.toHaveBeenCalled();
  });
});

describe("useDesktopPipVoiceConsumer", () => {
  let latest: ReturnType<typeof useDesktopPipVoiceConsumer> | null = null;

  function Consumer() {
    latest = useDesktopPipVoiceConsumer();
    return null;
  }

  beforeEach(async () => {
    platform.desktopBridge.windowRole = "pip";
    latest = null;
    await act(async () => root.render(<Consumer />));
  });

  it("shows the newest valid state for its Anima", () => {
    expect(latest?.voice).toBeNull();
    deliver(message("voice", speaking, { sequence: 2 }));
    expect(latest?.voice).toEqual(speaking);

    deliver(message("voice", idle, { sequence: 1 }));
    deliver(message("voice", idle, { sequence: 3, animaId: "other" }));
    deliver(message("voice", { activeMode: "voice" }, { sequence: 4 }));
    deliver(message("snapshot", idle, { sequence: 5 }));
    expect(latest?.voice).toEqual(speaking);

    deliver(message("voice", idle, { sequence: 6 }));
    expect(latest?.voice).toEqual(idle);
  });

  it("sends commands to the main window", () => {
    const command: DesktopPipVoiceCommand = "toggle-voice-mute";
    act(() => latest?.sendVoiceCommand(command));
    expect(published("voice-command")).toEqual([
      expect.objectContaining({
        animaId: "annie",
        sequence: 0,
        payload: { command },
      }),
    ]);
  });
});
