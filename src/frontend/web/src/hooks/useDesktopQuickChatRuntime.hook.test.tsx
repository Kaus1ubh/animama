// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePauseClosedQuickChatAnimations } from "./useDesktopQuickChatRuntime";

type QuickChatState = { isOpen: boolean; animaId: string; chatId: null };
type StateListener = (state: QuickChatState) => void;

const bridge = vi.hoisted(() => ({
  listeners: new Set<(state: { isOpen: boolean }) => void>(),
  initialState: null as Promise<{ isOpen: boolean }> | null,
}));

// The provider hands out one stable platform object, as the app's does.
const platform = vi.hoisted(() => ({
  kind: "desktop",
  capabilities: { nativeQuickChat: true },
  desktopBridge: {
    windowRole: "quick-chat",
    quickChat: {
      getState: () => bridge.initialState,
      onStateChange: (listener: StateListener) => {
        bridge.listeners.add(listener as never);
        return () => bridge.listeners.delete(listener as never);
      },
    },
  },
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => platform,
}));

function Probe() {
  usePauseClosedQuickChatAnimations();
  return null;
}

const ATTRIBUTE = "data-animama-quick-chat-closed";
let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => root.render(<Probe />));
}

function emit(isOpen: boolean) {
  act(() => {
    for (const listener of bridge.listeners) listener({ isOpen });
  });
}

describe("usePauseClosedQuickChatAnimations", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    bridge.listeners.clear();
    bridge.initialState = Promise.resolve({ isOpen: false });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("marks the document while the prewarmed window is closed", async () => {
    await mount();
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(true);

    emit(true);
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false);

    emit(false);
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(true);
  });

  it("keeps a state change that arrives before the initial state", async () => {
    let resolveInitial: (state: { isOpen: boolean }) => void = () => {};
    bridge.initialState = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    await mount();
    emit(true);
    await act(async () => resolveInitial({ isOpen: false }));
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false);
  });

  it("clears the mark on unmount", async () => {
    await mount();
    act(() => root.unmount());
    root = createRoot(container);
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false);
    expect(bridge.listeners.size).toBe(0);
  });
});
