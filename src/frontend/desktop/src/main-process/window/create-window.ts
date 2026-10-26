import { BrowserWindow, nativeTheme } from "electron";

import type { DesktopConfig } from "../config.js";
import { installFullscreenWindowEvents } from "../fullscreen/fullscreen-ipc.js";
import { installWindowGuards } from "../security/guards.js";
import { createLoadErrorHtml } from "../ui/load-error-page.js";
import { writeLog } from "../logging.js";
import { RuntimeError } from "../runtime/errors.js";
import {
  hiddenTitleBarOptions,
  registerTitleBarOverlayWindow,
} from "./title-bar.js";

type CreateWindowOptions = {
  config: DesktopConfig;
  preloadPath: string;
  onCreated?: (window: BrowserWindow) => void;
  failOnLoadError?: boolean;
};

async function loadWebUrl(
  window: BrowserWindow,
  config: DesktopConfig,
  failOnLoadError: boolean,
): Promise<void> {
  writeLog("info", `Loading ${config.webUrl.href}`);

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${config.loadTimeoutMs}ms`));
    }, config.loadTimeoutMs);
  });

  try {
    await Promise.race([window.loadURL(config.webUrl.href), timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLog("error", `Failed to load ${config.webUrl.href}: ${message}`);

    window.webContents.stop();
    if (failOnLoadError) throw new RuntimeError("renderer_load_failed");
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        createLoadErrorHtml(config.webUrl.href, message),
      )}`,
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function createWindow({
  config,
  preloadPath,
  onCreated,
  failOnLoadError = false,
}: CreateWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Animama",
    show: true,
    fullscreenable: true,
    ...hiddenTitleBarOptions(process.platform, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: preloadPath,
      additionalArguments: ["--animama-window-role=main"],
      partition: config.sessionPartition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  registerTitleBarOverlayWindow(window);
  onCreated?.(window);
  installFullscreenWindowEvents(window);
  installWindowGuards(window, config.allowedWebOrigin);

  try {
    await loadWebUrl(window, config, failOnLoadError);
  } catch (error) {
    window.destroy();
    throw error;
  }
  return window;
}
