import { ipcRenderer, type IpcRendererEvent } from "electron";

const PIP_OPEN_CHANNEL = "anima:pip:open";
const PIP_CLOSE_CHANNEL = "anima:pip:close";
const PIP_TOGGLE_CHANNEL = "anima:pip:toggle";
const PIP_GET_STATE_CHANNEL = "anima:pip:get-state";
const PIP_SET_BACKGROUND_MODE_CHANNEL = "anima:pip:set-background-mode";
const PIP_SET_SIZE_SCALE_CHANNEL = "anima:pip:set-size-scale";
const PIP_PUBLISH_RUNTIME_MESSAGE_CHANNEL = "anima:pip:publish-runtime-message";
const PIP_STATE_CHANGED_CHANNEL = "anima:pip:state-changed";
const PIP_RUNTIME_MESSAGE_CHANNEL = "anima:pip:runtime-message";
const PIP_CURSOR_SNAPSHOT_CHANNEL = "anima:pip:cursor-snapshot";

type DesktopPipBackgroundMode = "transparent" | "scene";

const DEFAULT_PIP_SIZE_SCALE = 0.5;

type DesktopPipOpenOptions = {
  animaId: string;
  chatId?: string | null;
  backgroundMode?: DesktopPipBackgroundMode;
  width?: number;
  height?: number;
};

type DesktopPipState = {
  isOpen: boolean;
  animaId: string | null;
  chatId: string | null;
  backgroundMode: DesktopPipBackgroundMode;
  isHovered: boolean;
  sizeScale: number;
};

type DesktopPipCursorSnapshot = {
  screen: { x: number; y: number };
  pipWindow: { x: number; y: number; width: number; height: number };
  local: { x: number; y: number };
  isInsidePip: boolean;
  sentAtMs: number;
};

type DesktopPipRuntimeMessage = {
  type: "ready" | "snapshot" | "incremental" | "camera-preset";
  sequence: number;
  sentAtMs: number;
  animaId: string;
  payload: unknown;
};

type PipStateCallback = (state: DesktopPipState) => void;
type PipRuntimeMessageCallback = (message: DesktopPipRuntimeMessage) => void;
type PipCursorSnapshotCallback = (snapshot: DesktopPipCursorSnapshot) => void;

const DEFAULT_PIP_STATE: DesktopPipState = {
  isOpen: false,
  animaId: null,
  chatId: null,
  backgroundMode: "transparent",
  isHovered: false,
  sizeScale: DEFAULT_PIP_SIZE_SCALE,
};

function normalizePipState(value: unknown): DesktopPipState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_PIP_STATE;
  }
  const state = value as Record<string, unknown>;
  return {
    isOpen: state.isOpen === true,
    animaId: typeof state.animaId === "string" ? state.animaId : null,
    chatId: typeof state.chatId === "string" ? state.chatId : null,
    backgroundMode: state.backgroundMode === "scene" ? "scene" : "transparent",
    isHovered: state.isHovered === true,
    sizeScale:
      typeof state.sizeScale === "number" && Number.isFinite(state.sizeScale)
        ? state.sizeScale
        : DEFAULT_PIP_STATE.sizeScale,
  };
}

function normalizeRuntimeMessage(
  value: unknown,
): DesktopPipRuntimeMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (
    message.type !== "ready" &&
    message.type !== "snapshot" &&
    message.type !== "incremental" &&
    message.type !== "camera-preset"
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
    sequence: message.sequence,
    sentAtMs: message.sentAtMs,
    animaId: message.animaId,
    payload: message.payload,
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const point = value as Record<string, unknown>;
  const x = readFiniteNumber(point.x);
  const y = readFiniteNumber(point.y);
  return x === null || y === null ? null : { x, y };
}

function normalizePipWindowBounds(
  value: unknown,
): DesktopPipCursorSnapshot["pipWindow"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const bounds = value as Record<string, unknown>;
  const x = readFiniteNumber(bounds.x);
  const y = readFiniteNumber(bounds.y);
  const width = readFiniteNumber(bounds.width);
  const height = readFiniteNumber(bounds.height);
  return x === null || y === null || width === null || height === null
    ? null
    : { x, y, width, height };
}

function normalizeCursorSnapshot(
  value: unknown,
): DesktopPipCursorSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as Record<string, unknown>;
  const screen = normalizePoint(snapshot.screen);
  const pipWindow = normalizePipWindowBounds(snapshot.pipWindow);
  const local = normalizePoint(snapshot.local);
  const sentAtMs = readFiniteNumber(snapshot.sentAtMs);
  if (!screen || !pipWindow || !local || sentAtMs === null) {
    return null;
  }
  return {
    screen,
    pipWindow,
    local,
    isInsidePip: snapshot.isInsidePip === true,
    sentAtMs,
  };
}

async function invokePipState(
  channel: string,
  value?: unknown,
): Promise<DesktopPipState> {
  const result =
    arguments.length === 2
      ? await ipcRenderer.invoke(channel, value)
      : await ipcRenderer.invoke(channel);
  return normalizePipState(result);
}

export function createPipBridge() {
  return {
    open: (options: DesktopPipOpenOptions) =>
      invokePipState(PIP_OPEN_CHANNEL, options),
    close: () => invokePipState(PIP_CLOSE_CHANNEL),
    toggle: (options: DesktopPipOpenOptions) =>
      invokePipState(PIP_TOGGLE_CHANNEL, options),
    isOpen: async () => {
      const state = await invokePipState(PIP_GET_STATE_CHANNEL);
      return state.isOpen;
    },
    getState: () => invokePipState(PIP_GET_STATE_CHANNEL),
    setBackgroundMode: (mode: DesktopPipBackgroundMode) =>
      invokePipState(PIP_SET_BACKGROUND_MODE_CHANNEL, mode),
    setSizeScale: (sizeScale: number) =>
      invokePipState(PIP_SET_SIZE_SCALE_CHANNEL, sizeScale),
    publishRuntimeMessage: async (message: DesktopPipRuntimeMessage) => {
      await ipcRenderer.invoke(PIP_PUBLISH_RUNTIME_MESSAGE_CHANNEL, message);
    },
    onStateChange: (callback: PipStateCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        callback(normalizePipState(value));
      };

      ipcRenderer.on(PIP_STATE_CHANGED_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(PIP_STATE_CHANGED_CHANNEL, listener);
      };
    },
    onRuntimeMessage: (callback: PipRuntimeMessageCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        const message = normalizeRuntimeMessage(value);
        if (message) {
          callback(message);
        }
      };

      ipcRenderer.on(PIP_RUNTIME_MESSAGE_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(PIP_RUNTIME_MESSAGE_CHANNEL, listener);
      };
    },
    onCursorSnapshot: (callback: PipCursorSnapshotCallback) => {
      const listener = (_event: IpcRendererEvent, value: unknown) => {
        const snapshot = normalizeCursorSnapshot(value);
        if (snapshot) {
          callback(snapshot);
        }
      };

      ipcRenderer.on(PIP_CURSOR_SNAPSHOT_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(PIP_CURSOR_SNAPSHOT_CHANNEL, listener);
      };
    },
  };
}
