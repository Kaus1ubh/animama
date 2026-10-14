import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { DesktopConfig } from "../config.js";
import type { ShellLocale } from "../locale/shell-locale.js";
import { writeLog } from "../logging.js";
import { QuickChatWindowManager } from "./quick-chat-window-manager.js";

export const QUICK_CHAT_OPEN_CHANNEL = "anima:quick-chat:open";
export const QUICK_CHAT_PREPARE_CHANNEL = "anima:quick-chat:prepare";
export const QUICK_CHAT_CLOSE_CHANNEL = "anima:quick-chat:close";
export const QUICK_CHAT_TOGGLE_CHANNEL = "anima:quick-chat:toggle";
export const QUICK_CHAT_GET_STATE_CHANNEL = "anima:quick-chat:get-state";
export const QUICK_CHAT_PUBLISH_RUNTIME_MESSAGE_CHANNEL =
  "anima:quick-chat:publish-runtime-message";
export const QUICK_CHAT_RUNTIME_MESSAGE_CHANNEL =
  "anima:quick-chat:runtime-message";
export const QUICK_CHAT_STATE_CHANGED_CHANNEL =
  "anima:quick-chat:state-changed";
export const QUICK_CHAT_SET_INTERACTIVE_REGIONS_CHANNEL =
  "anima:quick-chat:set-interactive-regions";
export const QUICK_CHAT_SET_LAYOUT_METRICS_CHANNEL =
  "anima:quick-chat:set-layout-metrics";

type InstallQuickChatIpcOptions = {
  config: DesktopConfig;
  locale: ShellLocale;
  preloadPath: string;
};

let quickChatIpcInstalled = false;

function assertLiveSender(event: IpcMainInvokeEvent) {
  if (event.sender.isDestroyed()) {
    writeLog(
      "error",
      "Quick Chat IPC request did not come from a live renderer",
    );
    throw new Error("Quick Chat IPC request did not come from a live renderer");
  }
  return event.sender;
}

export function installQuickChatIpc({
  config,
  locale,
  preloadPath,
}: InstallQuickChatIpcOptions): void {
  if (quickChatIpcInstalled) return;
  quickChatIpcInstalled = true;

  const manager = new QuickChatWindowManager({
    config,
    locale,
    preloadPath,
    runtimeMessageChannel: QUICK_CHAT_RUNTIME_MESSAGE_CHANNEL,
    stateChangedChannel: QUICK_CHAT_STATE_CHANGED_CHANNEL,
  });

  ipcMain.handle(
    QUICK_CHAT_OPEN_CHANNEL,
    async (event: IpcMainInvokeEvent, options: unknown) => {
      return manager.open(assertLiveSender(event), options);
    },
  );

  ipcMain.handle(
    QUICK_CHAT_PREPARE_CHANNEL,
    async (event: IpcMainInvokeEvent, options: unknown) => {
      return manager.prepare(assertLiveSender(event), options);
    },
  );

  ipcMain.handle(QUICK_CHAT_CLOSE_CHANNEL, () => {
    return manager.close();
  });

  ipcMain.handle(
    QUICK_CHAT_TOGGLE_CHANNEL,
    async (event: IpcMainInvokeEvent, options: unknown) => {
      return manager.toggle(assertLiveSender(event), options);
    },
  );

  ipcMain.handle(QUICK_CHAT_GET_STATE_CHANNEL, () => {
    return manager.getState();
  });

  ipcMain.handle(
    QUICK_CHAT_PUBLISH_RUNTIME_MESSAGE_CHANNEL,
    (event: IpcMainInvokeEvent, message: unknown) => {
      manager.publishRuntimeMessage(assertLiveSender(event), message);
    },
  );

  ipcMain.handle(
    QUICK_CHAT_SET_INTERACTIVE_REGIONS_CHANNEL,
    (event: IpcMainInvokeEvent, regions: unknown) => {
      manager.setInteractiveRegions(assertLiveSender(event), regions);
    },
  );

  ipcMain.handle(
    QUICK_CHAT_SET_LAYOUT_METRICS_CHANNEL,
    (event: IpcMainInvokeEvent, metrics: unknown) => {
      manager.setLayoutMetrics(assertLiveSender(event), metrics);
    },
  );
}
