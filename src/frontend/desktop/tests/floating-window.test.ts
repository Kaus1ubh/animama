import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  floatingWindowType,
  floatOnAllWorkspaces,
} from "../src/main-process/window/floating-window.js";

describe("floating windows", () => {
  it("uses a macOS panel and a Windows toolbar window", () => {
    expect(floatingWindowType("darwin")).toBe("panel");
    expect(floatingWindowType("win32")).toBe("toolbar");
    expect(floatingWindowType("linux")).toBe("toolbar");
  });

  it("joins full-screen workspaces without hiding the app from the Dock", () => {
    const setVisibleOnAllWorkspaces = vi.fn();
    floatOnAllWorkspaces({
      setVisibleOnAllWorkspaces,
    } as unknown as BrowserWindow);
    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });
});
