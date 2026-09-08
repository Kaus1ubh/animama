import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import { writeLog } from "../logging.js";

const FULLSCREEN_SET_CHANNEL = "anima:fullscreen:set";
const FULLSCREEN_TOGGLE_CHANNEL = "anima:fullscreen:toggle";
const FULLSCREEN_GET_CHANNEL = "anima:fullscreen:get";
const FULLSCREEN_CHANGED_CHANNEL = "anima:fullscreen:changed";

let fullscreenIpcInstalled = false;

function getWindowForEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    writeLog("error", "Fullscreen IPC request did not come from a live window");
    return null;
  }
  return window;
}

function setWindowFullscreen(
  window: BrowserWindow,
  isFullscreen: boolean,
): boolean {
  if (window.isFullScreen() !== isFullscreen) {
    window.setFullScreen(isFullscreen);
  }
  return window.isFullScreen();
}

export function installFullscreenIpc(): void {
  if (fullscreenIpcInstalled) return;
  fullscreenIpcInstalled = true;

  ipcMain.handle(
    FULLSCREEN_SET_CHANNEL,
    (event: IpcMainInvokeEvent, requestedState: unknown) => {
      if (typeof requestedState !== "boolean") {
        throw new Error("Expected boolean fullscreen state");
      }

      const window = getWindowForEvent(event);
      if (!window) return false;
      return setWindowFullscreen(window, requestedState);
    },
  );

  ipcMain.handle(FULLSCREEN_TOGGLE_CHANNEL, (event: IpcMainInvokeEvent) => {
    const window = getWindowForEvent(event);
    if (!window) return false;
    return setWindowFullscreen(window, !window.isFullScreen());
  });

  ipcMain.handle(FULLSCREEN_GET_CHANNEL, (event: IpcMainInvokeEvent) => {
    const window = getWindowForEvent(event);
    return window?.isFullScreen() ?? false;
  });
}

export function installFullscreenWindowEvents(window: BrowserWindow): void {
  const sendState = (isFullscreen: boolean) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(FULLSCREEN_CHANGED_CHANNEL, isFullscreen);
  };

  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.type !== "keyDown" ||
      (input.key !== "Escape" && input.code !== "Escape")
    ) {
      return;
    }
    if (!window.isFullScreen()) return;

    event.preventDefault();
    setWindowFullscreen(window, false);
  });

  window.on("enter-full-screen", () => {
    sendState(true);
  });

  window.on("leave-full-screen", () => {
    sendState(false);
  });
}
