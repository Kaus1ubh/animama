// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultDesktopShortcuts } from "@/lib/settings/desktop-shortcuts";
import { useDesktopPipShortcut } from "./useDesktopPipShortcut";

type ShortcutEvent = { action: string; phase: "down" | "up" };

const bridge = vi.hoisted(() => ({
  listeners: new Set<(event: ShortcutEvent) => void>(),
  configure: vi.fn<(config: unknown) => Promise<object>>(() =>
    Promise.resolve({}),
  ),
  setContext: vi.fn<(context: unknown) => Promise<object>>(() =>
    Promise.resolve({}),
  ),
}));

const settings = vi.hoisted(() => ({
  userPreferences: {} as { speech?: { desktop_shortcuts?: unknown } },
}));

// The provider hands out one stable platform object, as the app's does.
const platform = vi.hoisted(() => ({
  kind: "desktop",
  isDesktop: true,
  os: "darwin",
  desktopBridge: {
    shortcuts: {
      configure: bridge.configure,
      setContext: bridge.setContext,
      onEvent: (listener: (event: ShortcutEvent) => void) => {
        bridge.listeners.add(listener);
        return () => bridge.listeners.delete(listener);
      },
    },
  },
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => platform,
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({ userPreferences: settings.userPreferences }),
}));

function Probe({
  available,
  onToggle,
}: {
  available: boolean;
  onToggle: () => void;
}) {
  useDesktopPipShortcut({ available, onToggle });
  return null;
}

let container: HTMLDivElement;
let root: Root;

async function render(available: boolean, onToggle: () => void) {
  await act(async () =>
    root.render(<Probe available={available} onToggle={onToggle} />),
  );
}

function press(action: string, phase: "down" | "up" = "down") {
  act(() => {
    for (const listener of bridge.listeners) listener({ action, phase });
  });
}

describe("useDesktopPipShortcut", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    bridge.listeners.clear();
    bridge.configure.mockClear();
    bridge.setContext.mockClear();
    settings.userPreferences = {};
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reports PiP available and toggles it on the shortcut", async () => {
    const onToggle = vi.fn();
    await render(true, onToggle);

    expect(bridge.setContext).toHaveBeenLastCalledWith({ pipAvailable: true });
    press("quick_chat");
    press("toggle_pip", "up");
    expect(onToggle).not.toHaveBeenCalled();

    press("toggle_pip");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("withdraws availability when PiP becomes unavailable or unmounts", async () => {
    const onToggle = vi.fn();
    await render(true, onToggle);
    await render(false, onToggle);

    expect(bridge.setContext).toHaveBeenLastCalledWith({
      pipAvailable: false,
    });
    press("toggle_pip");
    expect(onToggle).not.toHaveBeenCalled();

    await render(true, onToggle);
    act(() => root.unmount());
    root = createRoot(container);
    expect(bridge.setContext).toHaveBeenLastCalledWith({
      pipAvailable: false,
    });
  });

  it("sends the shortcut map, so a rebinding applies without the chat", async () => {
    const onToggle = vi.fn();
    await render(true, onToggle);
    expect(bridge.configure).toHaveBeenLastCalledWith({
      shortcuts: defaultDesktopShortcuts("darwin"),
    });

    const rebound = { code: "KeyP", key: "p", ctrlKey: true };
    settings.userPreferences = {
      speech: { desktop_shortcuts: { toggle_pip: rebound } },
    };
    await render(true, onToggle);
    expect(bridge.configure).toHaveBeenLastCalledWith({
      shortcuts: { ...defaultDesktopShortcuts("darwin"), toggle_pip: rebound },
    });
  });

  it("calls the latest toggle without re-registering", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await render(true, first);
    await render(true, second);

    expect(bridge.setContext).toHaveBeenCalledTimes(1);
    press("toggle_pip");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
