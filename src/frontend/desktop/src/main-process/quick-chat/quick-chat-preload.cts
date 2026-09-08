import { ipcRenderer, type IpcRendererEvent } from "electron";

const QUICK_CHAT_OPEN_CHANNEL = "anima:quick-chat:open";
const QUICK_CHAT_PREPARE_CHANNEL = "anima:quick-chat:prepare";
const QUICK_CHAT_CLOSE_CHANNEL = "anima:quick-chat:close";
const QUICK_CHAT_TOGGLE_CHANNEL = "anima:quick-chat:toggle";
const QUICK_CHAT_GET_STATE_CHANNEL = "anima:quick-chat:get-state";
const QUICK_CHAT_PUBLISH_RUNTIME_MESSAGE_CHANNEL =
  "anima:quick-chat:publish-runtime-message";
const QUICK_CHAT_RUNTIME_MESSAGE_CHANNEL = "anima:quick-chat:runtime-message";
const QUICK_CHAT_STATE_CHANGED_CHANNEL = "anima:quick-chat:state-changed";
const QUICK_CHAT_SET_INTERACTIVE_REGIONS_CHANNEL =
  "anima:quick-chat:set-interactive-regions";
const QUICK_CHAT_SET_LAYOUT_METRICS_CHANNEL =
  "anima:quick-chat:set-layout-metrics";

type DesktopQuickChatOpenOptions = {
  animaId: string;
  chatId?: string | null;
  width?: number;
  height?: number;
};

type DesktopQuickChatState = {
  isOpen: boolean;
  animaId: string | null;
  chatId: string | null;
};

type DesktopQuickChatInteractiveRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DesktopQuickChatLayoutMetrics = {
  desiredHeight: number;
};

type DesktopQuickChatRuntimeMessage = {
  type: "ready" | "snapshot" | "command" | "request-snapshot" | "focus-input";
  sequence: number;
  sentAtMs: number;
  animaId: string;
  payload: unknown;
};

type QuickChatStateCallback = (state: DesktopQuickChatState) => void;
type QuickChatRuntimeMessageCallback = (
  message: DesktopQuickChatRuntimeMessage,
) => void;

const DEFAULT_QUICK_CHAT_STATE: DesktopQuickChatState = {
  isOpen: false,
  animaId: null,
  chatId: null,
};

function normalizeQuickChatState(value: unknown): DesktopQuickChatState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_QUICK_CHAT_STATE;
  }
  const state = value as Record<string, unknown>;
  return {
    isOpen: state.isOpen === true,
    animaId: typeof state.animaId === "string" ? state.animaId : null,
    chatId: typeof state.chatId === "string" ? state.chatId : null,
  };
}

function normalizeRuntimeMessage(
  value: unknown,
): DesktopQuickChatRuntimeMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (
    message.type !== "ready" &&
    message.type !== "snapshot" &&
    message.type !== "command" &&
    message.type !== "request-snapshot" &&
    message.type !== "focus-input"
  ) {
    return null;
  }
  if (
    typeof message.sequence !== "number" ||
    !Number.isFinite(message.sequence)
  ) {
    return null;
  }
  if (
    typeof message.sentAtMs !== "number" ||
    !Number.isFinite(message.sentAtMs)
  ) {
    return null;
  }
  if (typeof message.animaId !== "string" || !message.animaId.trim()) {
    return null;
  }
  return {
    type: message.type,
    sequence: Math.max(0, Math.round(message.sequence)),
    sentAtMs: message.sentAtMs,
    animaId: message.animaId,
    payload: message.payload,
  };
}

function normalizeInteractiveRegions(
  regions: DesktopQuickChatInteractiveRegion[],
): DesktopQuickChatInteractiveRegion[] {
  return regions
    .map((region) => ({
      x: Math.max(0, Math.round(region.x)),
      y: Math.max(0, Math.round(region.y)),
      width: Math.max(0, Math.round(region.width)),
      height: Math.max(0, Math.round(region.height)),
    }))
    .filter((region) => region.width > 0 && region.height > 0);
}

function normalizeLayoutMetrics(
  metrics: DesktopQuickChatLayoutMetrics,
): DesktopQuickChatLayoutMetrics {
  return {
    desiredHeight: Math.max(0, Math.round(metrics.desiredHeight)),
  };
}

async function invokeQuickChatState(
  channel: string,
  value?: unknown,
): Promise<DesktopQuickChatState> {
  const result =
    arguments.length === 2
      ? await ipcRenderer.invoke(channel, value)
      : await ipcRenderer.invoke(channel);
  return normalizeQuickChatState(result);
}

export function createQuickChatBridge() {
  return {
    open: (options: DesktopQuickChatOpenOptions) =>
      invokeQuickChatState(QUICK_CHAT_OPEN_CHANNEL, options),
    prepare: (options: DesktopQuickChatOpenOptions) =>
      invokeQuickChatState(QUICK_CHAT_PREPARE_CHANNEL, options),
    close: () => invokeQuickChatState(QUICK_CHAT_CLOSE_CHANNEL),
    toggle: (options: DesktopQuickChatOpenOptions) =>
      invokeQuickChatState(QUICK_CHAT_TOGGLE_CHANNEL, options),
    getState: () => invokeQuickChatState(QUICK_CHAT_GET_STATE_CHANNEL),
    publishRuntimeMessage: async (message: DesktopQuickChatRuntimeMessage) => {
      await ipcRenderer.invoke(
        QUICK_CHAT_PUBLISH_RUNTIME_MESSAGE_CHANNEL,
        message,
      );
    },
    onRuntimeMessage: (callback: QuickChatRuntimeMessageCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        const message = normalizeRuntimeMessage(value);
        if (message) {
          callback(message);
        }
      };

      ipcRenderer.on(QUICK_CHAT_RUNTIME_MESSAGE_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(
          QUICK_CHAT_RUNTIME_MESSAGE_CHANNEL,
          listener,
        );
      };
    },
    onStateChange: (callback: QuickChatStateCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        callback(normalizeQuickChatState(value));
      };

      ipcRenderer.on(QUICK_CHAT_STATE_CHANGED_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(QUICK_CHAT_STATE_CHANGED_CHANNEL, listener);
      };
    },
    setInteractiveRegions: async (
      regions: DesktopQuickChatInteractiveRegion[],
    ) => {
      await ipcRenderer.invoke(
        QUICK_CHAT_SET_INTERACTIVE_REGIONS_CHANNEL,
        normalizeInteractiveRegions(regions),
      );
    },
    setLayoutMetrics: async (metrics: DesktopQuickChatLayoutMetrics) => {
      await ipcRenderer.invoke(
        QUICK_CHAT_SET_LAYOUT_METRICS_CHANNEL,
        normalizeLayoutMetrics(metrics),
      );
    },
  };
}
