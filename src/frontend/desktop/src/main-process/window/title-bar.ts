import {
  BrowserWindow,
  ipcMain,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron";

import { writeLog } from "../logging.js";

export const TITLE_BAR_SET_COLORS_CHANNEL = "anima:title-bar:set-colors";

/** Height of the Windows strip that holds minimize, maximize and close. */
export const WINDOWS_TITLE_BAR_HEIGHT = 32;

export type TitleBarColors = {
  /** Background of the window buttons; matches the app background. */
  color: string;
  /** Glyph color of the window buttons. */
  symbolColor: string;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Window buttons in the default theme's background and foreground until the
 * web app reports its own colors.
 */
function defaultTitleBarColors(dark: boolean): TitleBarColors {
  return dark
    ? { color: "#21252e", symbolColor: "#e5e5e5" }
    : { color: "#faf9f5", symbolColor: "#333333" };
}

/**
 * Main-window options that replace the native title bar with a strip the web
 * app draws in its own background. macOS keeps its traffic lights there;
 * Windows draws minimize, maximize and close over it. Both expose the strip to
 * the page as the window-controls overlay (`env(titlebar-area-height)`), which
 * is empty in fullscreen. Linux keeps the native frame, since its window
 * managers draw and place their own.
 */
export function hiddenTitleBarOptions(
  platform: NodeJS.Platform,
  dark: boolean,
): BrowserWindowConstructorOptions {
  if (platform === "darwin") {
    return { titleBarStyle: "hidden", titleBarOverlay: true };
  }
  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: {
        ...defaultTitleBarColors(dark),
        height: WINDOWS_TITLE_BAR_HEIGHT,
      },
    };
  }
  return {};
}

/** Validates the renderer's colors: two `#rrggbb` strings. */
export function readTitleBarColors(value: unknown): TitleBarColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected title bar colors");
  }
  const { color, symbolColor } = value as Record<string, unknown>;
  if (
    typeof color !== "string" ||
    typeof symbolColor !== "string" ||
    !HEX_COLOR.test(color) ||
    !HEX_COLOR.test(symbolColor)
  ) {
    throw new Error("Expected #rrggbb title bar colors");
  }
  return { color, symbolColor };
}

/** Windows created with drawn window buttons; only they accept colors. */
const overlayWindows = new WeakSet<BrowserWindow>();

export function registerTitleBarOverlayWindow(window: BrowserWindow): void {
  if (process.platform === "win32") overlayWindows.add(window);
}

let titleBarIpcInstalled = false;

/** Lets the main window recolor its Windows window buttons to its theme. */
export function installTitleBarIpc(): void {
  if (titleBarIpcInstalled) return;
  titleBarIpcInstalled = true;

  ipcMain.handle(
    TITLE_BAR_SET_COLORS_CHANNEL,
    (event: IpcMainInvokeEvent, rawColors: unknown) => {
      const colors = readTitleBarColors(rawColors);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed() || !overlayWindows.has(window)) {
        return;
      }
      try {
        window.setTitleBarOverlay(colors);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeLog("error", `Could not recolor the title bar: ${message}`);
      }
    },
  );
}
