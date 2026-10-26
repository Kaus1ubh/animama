import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("../src/main-process/logging.js", () => ({
  writeLog: () => undefined,
}));

import {
  hiddenTitleBarOptions,
  readTitleBarColors,
  WINDOWS_TITLE_BAR_HEIGHT,
} from "../src/main-process/window/title-bar.js";

describe("hiddenTitleBarOptions", () => {
  it("keeps the macOS traffic lights over a hidden title bar", () => {
    expect(hiddenTitleBarOptions("darwin", false)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: true,
    });
  });

  it("draws Windows window buttons in the theme's colors", () => {
    expect(hiddenTitleBarOptions("win32", true)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#21252e",
        symbolColor: "#e5e5e5",
        height: WINDOWS_TITLE_BAR_HEIGHT,
      },
    });
  });

  it("leaves the Linux frame to the window manager", () => {
    expect(hiddenTitleBarOptions("linux", false)).toEqual({});
  });
});

describe("readTitleBarColors", () => {
  it("accepts two #rrggbb colors", () => {
    expect(
      readTitleBarColors({ color: "#FAF9F5", symbolColor: "#333333" }),
    ).toEqual({ color: "#FAF9F5", symbolColor: "#333333" });
  });

  it.each([
    null,
    "#ffffff",
    { color: "#fff", symbolColor: "#000000" },
    { color: "red", symbolColor: "#000000" },
    { color: "#ffffff" },
  ])("rejects %j", (value) => {
    expect(() => readTitleBarColors(value)).toThrow();
  });
});
