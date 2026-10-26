import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { DesktopConfig } from "../config.js";
import type { ShellLocale } from "../locale/shell-locale.js";
import { writeLog } from "../logging.js";
import { PipWindowManager } from "./pip-window-manager.js";

export const PIP_OPEN_CHANNEL = "anima:pip:open";
export const PIP_CLOSE_CHANNEL = "anima:pip:close";
export const PIP_TOGGLE_CHANNEL = "anima:pip:toggle";
export const PIP_GET_STATE_CHANNEL = "anima:pip:get-state";
export const PIP_SET_BACKGROUND_MODE_CHANNEL = "anima:pip:set-background-mode";
export const PIP_SET_SIZE_SCALE_CHANNEL = "anima:pip:set-size-scale";
export const PIP_SET_GRIP_RESIZING_CHANNEL = "anima:pip:set-grip-resizing";
export const PIP_PUBLISH_RUNTIME_MESSAGE_CHANNEL =
  "anima:pip:publish-runtime-message";
export const PIP_STATE_CHANGED_CHANNEL = "anima:pip:state-changed";
export const PIP_RUNTIME_MESSAGE_CHANNEL = "anima:pip:runtime-message";
export const PIP_CURSOR_SNAPSHOT_CHANNEL = "anima:pip:cursor-snapshot";

type InstallPipIpcOptions = {
  config: DesktopConfig;
  locale: ShellLocale;
  preloadPath: string;
};

let pipIpcInstalled = false;

function assertLiveSender(event: IpcMainInvokeEvent) {
  if (event.sender.isDestroyed()) {
    writeLog("error", "PiP IPC request did not come from a live renderer");
    throw new Error("PiP IPC request did not come from a live renderer");
  }
  return event.sender;
}

export function installPipIpc({
  config,
  locale,
  preloadPath,
}: InstallPipIpcOptions): void {
  if (pipIpcInstalled) return;
  pipIpcInstalled = true;

  const manager = new PipWindowManager({
    config,
    locale,
    cursorSnapshotChannel: PIP_CURSOR_SNAPSHOT_CHANNEL,
    preloadPath,
    runtimeMessageChannel: PIP_RUNTIME_MESSAGE_CHANNEL,
    stateChangedChannel: PIP_STATE_CHANGED_CHANNEL,
  });

  ipcMain.handle(
    PIP_OPEN_CHANNEL,
    async (event: IpcMainInvokeEvent, options: unknown) => {
      return manager.open(assertLiveSender(event), options);
    },
  );

  ipcMain.handle(PIP_CLOSE_CHANNEL, () => {
    return manager.close();
  });

  ipcMain.handle(
    PIP_TOGGLE_CHANNEL,
    async (event: IpcMainInvokeEvent, options: unknown) => {
      return manager.toggle(assertLiveSender(event), options);
    },
  );

  ipcMain.handle(PIP_GET_STATE_CHANNEL, () => {
    return manager.getState();
  });

  ipcMain.handle(
    PIP_SET_BACKGROUND_MODE_CHANNEL,
    (_event: IpcMainInvokeEvent, mode: unknown) => {
      return manager.setBackgroundMode(mode);
    },
  );

  ipcMain.handle(
    PIP_SET_SIZE_SCALE_CHANNEL,
    (_event: IpcMainInvokeEvent, sizeScale: unknown) => {
      return manager.setSizeScale(sizeScale);
    },
  );

  ipcMain.handle(
    PIP_SET_GRIP_RESIZING_CHANNEL,
    (event: IpcMainInvokeEvent, active: unknown) => {
      manager.setGripResizing(assertLiveSender(event), active);
    },
  );

  ipcMain.handle(
    PIP_PUBLISH_RUNTIME_MESSAGE_CHANNEL,
    (event: IpcMainInvokeEvent, message: unknown) => {
      manager.publishRuntimeMessage(assertLiveSender(event), message);
    },
  );
}
