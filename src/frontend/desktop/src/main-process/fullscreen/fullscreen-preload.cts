import { ipcRenderer, type IpcRendererEvent } from "electron";

const FULLSCREEN_SET_CHANNEL = "anima:fullscreen:set";
const FULLSCREEN_TOGGLE_CHANNEL = "anima:fullscreen:toggle";
const FULLSCREEN_GET_CHANNEL = "anima:fullscreen:get";
const FULLSCREEN_CHANGED_CHANNEL = "anima:fullscreen:changed";

type FullscreenChangeCallback = (isFullscreen: boolean) => void;

async function invokeFullscreenState(
  channel: string,
  value?: boolean,
): Promise<boolean> {
  const result =
    typeof value === "boolean"
      ? await ipcRenderer.invoke(channel, value)
      : await ipcRenderer.invoke(channel);
  return result === true;
}

export function createFullscreenBridge() {
  return {
    enter: () => invokeFullscreenState(FULLSCREEN_SET_CHANNEL, true),
    exit: () => invokeFullscreenState(FULLSCREEN_SET_CHANNEL, false),
    toggle: () => invokeFullscreenState(FULLSCREEN_TOGGLE_CHANNEL),
    isFullscreen: () => invokeFullscreenState(FULLSCREEN_GET_CHANNEL),
    onChange: (callback: FullscreenChangeCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        if (typeof value === "boolean") {
          callback(value);
        }
      };

      ipcRenderer.on(FULLSCREEN_CHANGED_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(FULLSCREEN_CHANGED_CHANNEL, listener);
      };
    },
  };
}
