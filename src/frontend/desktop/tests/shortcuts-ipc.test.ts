import { beforeAll, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const { handlers, registered } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  registered: new Map<string, () => void>(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: {
    fromWebContents: () => ({ isDestroyed: () => false }),
  },
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => {
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator: string) => {
      registered.delete(accelerator);
    },
  },
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) => {
      handlers.set(channel, callback);
    },
  },
}));
vi.mock("../src/main-process/logging.js", () => ({
  writeLog: () => undefined,
}));
vi.mock("../src/main-process/shortcuts/global-input-hook.js", () => ({
  createGlobalInputHook: () => ({
    supported: false,
    requiresPermission: false,
    start: vi.fn(),
    stop: vi.fn(),
    requestPermission: () => false,
  }),
}));

import {
  installShortcutsIpc,
  SHORTCUTS_CONFIGURE_CHANNEL,
  SHORTCUTS_EVENT_CHANNEL,
  SHORTCUTS_SET_CONTEXT_CHANNEL,
} from "../src/main-process/shortcuts/shortcuts-ipc.js";

const SHORTCUTS = {
  press_to_talk: { code: "Backquote", ctrlKey: true },
  quick_chat: { code: "Slash", ctrlKey: true },
  toggle_dictation: { code: "Period", ctrlKey: true },
  toggle_voice_mode: { code: "Semicolon", ctrlKey: true },
  toggle_voice_mute: { code: "Quote", ctrlKey: true },
  skip_tts: { code: "BracketRight", ctrlKey: true },
  toggle_pip: { code: "Comma", ctrlKey: true },
};

const mainWindow = {
  isDestroyed: () => false,
  getURL: () => "http://127.0.0.1:41234/anima-1",
  once: vi.fn(),
  send: vi.fn(),
};
const event = { sender: mainWindow } as unknown as IpcMainInvokeEvent;

function invoke(channel: string, value: unknown) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler(event, value);
}

describe("desktop PiP shortcut", () => {
  beforeAll(async () => {
    installShortcutsIpc();
    await invoke(SHORTCUTS_CONFIGURE_CHANNEL, { shortcuts: SHORTCUTS });
  });

  it("is registered only while the main window reports PiP available", async () => {
    expect(registered.has("Ctrl+,")).toBe(false);

    await invoke(SHORTCUTS_SET_CONTEXT_CHANNEL, { pipAvailable: true });
    expect(registered.has("Ctrl+,")).toBe(true);

    await invoke(SHORTCUTS_SET_CONTEXT_CHANNEL, { pipAvailable: false });
    expect(registered.has("Ctrl+,")).toBe(false);
  });

  it("sends a toggle_pip event to the main window when pressed", async () => {
    await invoke(SHORTCUTS_SET_CONTEXT_CHANNEL, { pipAvailable: true });
    mainWindow.send.mockClear();

    registered.get("Ctrl+,")?.();

    expect(mainWindow.send).toHaveBeenCalledWith(SHORTCUTS_EVENT_CHANNEL, {
      action: "toggle_pip",
      phase: "down",
    });
  });

  it("keeps PiP availability when chat updates its own context", async () => {
    await invoke(SHORTCUTS_SET_CONTEXT_CHANNEL, { pipAvailable: true });
    await invoke(SHORTCUTS_SET_CONTEXT_CHANNEL, {
      quickChatAvailable: false,
      voiceModeAvailable: false,
    });

    expect(registered.has("Ctrl+,")).toBe(true);
  });
});
