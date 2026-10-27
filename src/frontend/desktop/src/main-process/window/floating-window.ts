import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

/**
 * Window type for the always-on-top PiP and Quick Chat windows. On macOS a
 * non-activating panel floats over other apps' full-screen spaces by itself;
 * elsewhere `toolbar` keeps the window off the Windows taskbar.
 */
export function floatingWindowType(
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions["type"] {
  return platform === "darwin" ? "panel" : "toolbar";
}

/** Keep a floating window on every workspace, including full-screen ones. */
export function floatOnAllWorkspaces(window: BrowserWindow): void {
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    // Otherwise Electron calls `app.dock.hide()` on macOS, which leaves the
    // whole app out of the Dock and Command-Tab. The panel type above already
    // lets the window float over full-screen apps.
    skipTransformProcessType: true,
  });
}
