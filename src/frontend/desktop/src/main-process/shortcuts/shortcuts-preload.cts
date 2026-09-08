import { ipcRenderer, type IpcRendererEvent } from "electron";

const SHORTCUTS_CONFIGURE_CHANNEL = "anima:shortcuts:configure";
const SHORTCUTS_SET_CONTEXT_CHANNEL = "anima:shortcuts:set-context";
const SHORTCUTS_REQUEST_PERMISSIONS_CHANNEL =
  "anima:shortcuts:request-permissions";
const SHORTCUTS_GET_STATUS_CHANNEL = "anima:shortcuts:get-status";
const SHORTCUTS_EVENT_CHANNEL = "anima:shortcuts:event";
const SHORTCUTS_STATUS_CHANGED_CHANNEL = "anima:shortcuts:status-changed";

type DesktopShortcutAction =
  | "press_to_talk"
  | "quick_chat"
  | "toggle_voice_mode"
  | "toggle_voice_mute"
  | "skip_tts";

type DesktopKeyboardShortcut = {
  type?: "keyboard";
  code: string;
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

type DesktopMouseShortcut = {
  type: "mouse";
  button: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

type DesktopShortcut = DesktopKeyboardShortcut | DesktopMouseShortcut;

type DesktopShortcutsConfig = {
  shortcuts: Record<DesktopShortcutAction, DesktopShortcut>;
};

type DesktopShortcutsContext = {
  quickChatAvailable: boolean;
  voiceModeAvailable: boolean;
  voiceModeActive: boolean;
  ttsAudioActive: boolean;
  shortcutCaptureActive: boolean;
};

type DesktopShortcutEvent = {
  action: DesktopShortcutAction;
  phase: "down" | "up";
};

type DesktopShortcutsStatus = {
  platform: string;
  supported: boolean;
  enabled: boolean;
  requiresPermission: boolean;
  reason: string | null;
  error: string | null;
};

type ShortcutEventCallback = (event: DesktopShortcutEvent) => void;
type ShortcutStatusCallback = (status: DesktopShortcutsStatus) => void;

const DEFAULT_STATUS: DesktopShortcutsStatus = {
  platform: process.platform,
  supported: false,
  enabled: false,
  requiresPermission: false,
  reason: "Desktop shortcuts are unavailable.",
  error: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStatus(value: unknown): DesktopShortcutsStatus {
  if (!isRecord(value)) return DEFAULT_STATUS;
  return {
    platform:
      typeof value.platform === "string" && value.platform
        ? value.platform
        : process.platform,
    supported: value.supported === true,
    enabled: value.enabled === true,
    requiresPermission: value.requiresPermission === true,
    reason: typeof value.reason === "string" ? value.reason : null,
    error: typeof value.error === "string" ? value.error : null,
  };
}

function normalizeShortcutEvent(value: unknown): DesktopShortcutEvent | null {
  if (!isRecord(value)) return null;
  if (
    value.action !== "press_to_talk" &&
    value.action !== "quick_chat" &&
    value.action !== "toggle_voice_mode" &&
    value.action !== "toggle_voice_mute" &&
    value.action !== "skip_tts"
  ) {
    return null;
  }
  if (value.phase !== "down" && value.phase !== "up") {
    return null;
  }
  return {
    action: value.action,
    phase: value.phase,
  };
}

async function invokeStatus(
  channel: string,
  value?: unknown,
): Promise<DesktopShortcutsStatus> {
  const result =
    arguments.length === 2
      ? await ipcRenderer.invoke(channel, value)
      : await ipcRenderer.invoke(channel);
  return normalizeStatus(result);
}

export function createShortcutsBridge() {
  return {
    configure: (config: DesktopShortcutsConfig) =>
      invokeStatus(SHORTCUTS_CONFIGURE_CHANNEL, config),
    setContext: (context: Partial<DesktopShortcutsContext>) =>
      invokeStatus(SHORTCUTS_SET_CONTEXT_CHANNEL, context),
    requestPermissions: () =>
      invokeStatus(SHORTCUTS_REQUEST_PERMISSIONS_CHANNEL),
    getStatus: () => invokeStatus(SHORTCUTS_GET_STATUS_CHANNEL),
    onEvent: (callback: ShortcutEventCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        const shortcutEvent = normalizeShortcutEvent(value);
        if (shortcutEvent) {
          callback(shortcutEvent);
        }
      };

      ipcRenderer.on(SHORTCUTS_EVENT_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(SHORTCUTS_EVENT_CHANNEL, listener);
      };
    },
    onStatusChange: (callback: ShortcutStatusCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        callback(normalizeStatus(value));
      };

      ipcRenderer.on(SHORTCUTS_STATUS_CHANGED_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(SHORTCUTS_STATUS_CHANGED_CHANNEL, listener);
      };
    },
  };
}
