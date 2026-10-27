// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginItemStatus } from "../../../shared/desktop-runtime";
import { useDesktopLoginItem } from "./useDesktopLoginItem";

const bridge = vi.hoisted(() => ({
  status: vi.fn<() => Promise<LoginItemStatus>>(),
  setEnabled: vi.fn<(enabled: boolean) => Promise<LoginItemStatus>>(),
}));
// The provider hands out one stable platform object, as the app's does.
const platform = vi.hoisted(() => ({
  kind: "desktop",
  isDesktop: true,
  desktopBridge: { windowRole: "main", loginItem: bridge },
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => platform,
}));

const off: LoginItemStatus = {
  available: true,
  enabled: false,
  blockedBySystem: false,
};
const on: LoginItemStatus = { ...off, enabled: true };

const result = {
  current: null as unknown as ReturnType<typeof useDesktopLoginItem>,
};
function Probe({ shown }: { shown?: boolean }) {
  result.current = useDesktopLoginItem(shown);
  return null;
}

let container: HTMLDivElement;
let root: Root;
async function render(shown?: boolean) {
  await act(async () => root.render(<Probe shown={shown} />));
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  bridge.status.mockReset().mockResolvedValue(off);
  bridge.setEnabled.mockReset().mockResolvedValue(on);
  platform.desktopBridge.windowRole = "main";
});
afterEach(() => {
  act(() => root.unmount());
});

describe("useDesktopLoginItem", () => {
  it("reads the OS state and reads it again when the window regains focus", async () => {
    await render();
    expect(result.current.status).toEqual(off);
    bridge.status.mockResolvedValue({ ...on, blockedBySystem: true });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(result.current.status).toEqual({ ...on, blockedBySystem: true });
  });

  it("reads it on focus only while the setting is shown", async () => {
    await render(false);
    expect(bridge.status).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(bridge.status).toHaveBeenCalledOnce();
    bridge.status.mockResolvedValue(on);
    await render(true);
    expect(result.current.status).toEqual(on);
  });

  it("shows the state the OS holds after a change, and after a refused one", async () => {
    await render();
    await act(() => result.current.setEnabled(true));
    expect(bridge.setEnabled).toHaveBeenCalledWith(true);
    expect(result.current.status).toEqual(on);

    bridge.setEnabled.mockRejectedValue(new Error("login_item_unchanged"));
    bridge.status.mockResolvedValue(on);
    await act(async () => {
      await expect(result.current.setEnabled(false)).rejects.toThrow(
        "login_item_unchanged",
      );
    });
    expect(result.current.status).toEqual(on);
    expect(result.current.pending).toBe(false);
  });

  it("stays unavailable outside the main window", async () => {
    platform.desktopBridge.windowRole = "pip";
    await render();
    expect(result.current.status).toEqual({ available: false });
    expect(bridge.status).not.toHaveBeenCalled();
  });
});
