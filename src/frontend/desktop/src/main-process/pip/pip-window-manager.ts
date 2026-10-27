import { BrowserWindow, screen, type WebContents } from "electron";

import type { DesktopConfig } from "../config.js";
import {
  keepLocalizedTitle,
  type ShellLocale,
} from "../locale/shell-locale.js";
import { writeLog } from "../logging.js";
import { installWindowGuards } from "../security/guards.js";

export type DesktopPipBackgroundMode = "transparent" | "scene";

export type DesktopPipOpenOptions = {
  animaId: string;
  chatId?: string | null;
  backgroundMode?: DesktopPipBackgroundMode;
  width?: number;
  height?: number;
};

export type DesktopPipState = {
  isOpen: boolean;
  animaId: string | null;
  chatId: string | null;
  backgroundMode: DesktopPipBackgroundMode;
  isHovered: boolean;
  sizeScale: number;
};

export type DesktopPipCursorSnapshot = {
  screen: Point;
  pipWindow: Bounds;
  local: Point;
  isInsidePip: boolean;
  sentAtMs: number;
};

/**
 * Messages between the owner window and PiP. PiP sends `ready`,
 * `camera-preset` and `voice-command`; the owner sends Avatar `snapshot` /
 * `incremental` state and `voice` state.
 */
export type DesktopPipRuntimeMessage = {
  type:
    | "ready"
    | "snapshot"
    | "incremental"
    | "camera-preset"
    | "voice"
    | "voice-command";
  sequence: number;
  sentAtMs: number;
  animaId: string;
  payload: unknown;
};

type PipWindowManagerOptions = {
  config: DesktopConfig;
  /** Supplies the localized window title. */
  locale: ShellLocale;
  cursorSnapshotChannel: string;
  preloadPath: string;
  runtimeMessageChannel: string;
  stateChangedChannel: string;
};

export type PipMouseZone = "outside" | "interactive" | "pass-through";

type Point = {
  x: number;
  y: number;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_PIP_WIDTH = 420;
const DEFAULT_PIP_HEIGHT = 560;
const MIN_PIP_SIZE_SCALE = 0.275;
const MIN_PIP_WIDTH = Math.round(DEFAULT_PIP_WIDTH * MIN_PIP_SIZE_SCALE);
const MIN_PIP_HEIGHT = Math.round(DEFAULT_PIP_HEIGHT * MIN_PIP_SIZE_SCALE);
const MAX_PIP_WIDTH = 1200;
const MAX_PIP_HEIGHT = 1200;
const DEFAULT_BACKGROUND_MODE: DesktopPipBackgroundMode = "transparent";
const DEFAULT_PIP_SIZE_SCALE = 0.5;
const MAX_PIP_SIZE_SCALE = 1.6;
const PIP_DEFAULT_RIGHT_MARGIN = 24;
const PIP_DEFAULT_BOTTOM_MARGIN = 32;
const PIP_MOUSE_POLL_INTERVAL_MS = 50;
/** The route's hover toolbar spans the top of the window, about 33px tall. */
const PIP_TOOLBAR_HIT_ZONE_HEIGHT = 40;
/** The route's resize grip sits in the bottom-right corner. */
const PIP_RESIZE_GRIP_HIT_ZONE_SIZE = 24;
const PIP_RESIZE_INTERVAL_MS = 16;

function readAnimaId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected PiP animaId");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Expected PiP animaId");
  }
  return trimmed;
}

function readOptionalNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error("Expected nullable string");
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBackgroundMode(value: unknown): DesktopPipBackgroundMode {
  return value === "scene" ? "scene" : DEFAULT_BACKGROUND_MODE;
}

function clampWindowSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampPipSizeScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PIP_SIZE_SCALE;
  }
  return Math.max(MIN_PIP_SIZE_SCALE, Math.min(MAX_PIP_SIZE_SCALE, value));
}

function resolveSizeScaleForWindowSize(width: number, height: number): number {
  const widthScale = width / DEFAULT_PIP_WIDTH;
  const heightScale = height / DEFAULT_PIP_HEIGHT;
  return clampPipSizeScale((widthScale + heightScale) / 2);
}

/**
 * The size scale that brings the window's bottom-right corner closest to the
 * cursor after it moved `dx`/`dy` from where a grip drag began. The aspect
 * ratio is fixed, so the corner follows the cursor's movement along the
 * window's diagonal.
 */
export function resolveCornerResizeScale(
  startScale: number,
  dx: number,
  dy: number,
): number {
  const diagonalScale =
    (dx * DEFAULT_PIP_WIDTH + dy * DEFAULT_PIP_HEIGHT) /
    (DEFAULT_PIP_WIDTH ** 2 + DEFAULT_PIP_HEIGHT ** 2);
  return clampPipSizeScale(startScale + diagonalScale);
}

function resolveWindowSizeForScale(sizeScale: number): {
  width: number;
  height: number;
} {
  return {
    width: clampWindowSize(
      DEFAULT_PIP_WIDTH * sizeScale,
      DEFAULT_PIP_WIDTH,
      MIN_PIP_WIDTH,
      MAX_PIP_WIDTH,
    ),
    height: clampWindowSize(
      DEFAULT_PIP_HEIGHT * sizeScale,
      DEFAULT_PIP_HEIGHT,
      MIN_PIP_HEIGHT,
      MAX_PIP_HEIGHT,
    ),
  };
}

function resolveDefaultWindowSize(): {
  width: number;
  height: number;
} {
  return resolveWindowSizeForScale(DEFAULT_PIP_SIZE_SCALE);
}

function isLiveWebContents(
  contents: WebContents | null,
): contents is WebContents {
  return Boolean(contents && !contents.isDestroyed());
}

function isPipRouteUrl(value: string, allowedWebOrigin: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === allowedWebOrigin &&
      url.pathname.startsWith("/desktop/pip/")
    );
  } catch {
    return false;
  }
}

function resolveDefaultPipBounds(
  ownerContents: WebContents,
  width: number,
  height: number,
): Bounds {
  const ownerWindow = BrowserWindow.fromWebContents(ownerContents);
  const display =
    ownerWindow && !ownerWindow.isDestroyed()
      ? screen.getDisplayMatching(ownerWindow.getBounds())
      : screen.getPrimaryDisplay();
  const { workArea } = display;

  return {
    x: Math.max(
      workArea.x,
      Math.round(
        workArea.x + workArea.width - width - PIP_DEFAULT_RIGHT_MARGIN,
      ),
    ),
    y: Math.max(
      workArea.y,
      Math.round(
        workArea.y + workArea.height - height - PIP_DEFAULT_BOTTOM_MARGIN,
      ),
    ),
    width,
    height,
  };
}

function syncPipWindowVisibility(
  window: BrowserWindow,
  allowedWebOrigin: string,
  allowShow: boolean,
  beforeHide?: () => void,
): void {
  if (window.isDestroyed()) return;
  if (
    isPipRouteUrl(window.webContents.getURL(), allowedWebOrigin) &&
    allowShow
  ) {
    if (!window.isVisible()) {
      window.show();
    }
    return;
  }
  if (window.isVisible()) {
    beforeHide?.();
    window.hide();
  }
}

function isPointInsideBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function isInResizeGripZone(
  localX: number,
  localY: number,
  bounds: Bounds,
): boolean {
  return (
    localX >= bounds.width - PIP_RESIZE_GRIP_HIT_ZONE_SIZE &&
    localY >= bounds.height - PIP_RESIZE_GRIP_HIT_ZONE_SIZE
  );
}

/**
 * Where the cursor is relative to the PiP window. Only the hover toolbar and
 * the resize grip take mouse input; the rest of the window passes clicks to
 * the app underneath.
 */
export function classifyPipMouseZone(
  cursor: Point,
  bounds: Bounds,
): PipMouseZone {
  if (!isPointInsideBounds(cursor, bounds)) {
    return "outside";
  }

  const localX = cursor.x - bounds.x;
  const localY = cursor.y - bounds.y;
  if (
    localY < PIP_TOOLBAR_HIT_ZONE_HEIGHT ||
    isInResizeGripZone(localX, localY, bounds)
  ) {
    return "interactive";
  }

  return "pass-through";
}

function canCloneRuntimeMessage(message: DesktopPipRuntimeMessage): boolean {
  try {
    structuredClone(message);
    return true;
  } catch {
    return false;
  }
}

function normalizeOpenOptions(value: unknown): Required<DesktopPipOpenOptions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected PiP open options");
  }
  const options = value as Record<string, unknown>;
  const defaultSize = resolveDefaultWindowSize();
  return {
    animaId: readAnimaId(options.animaId),
    chatId: readOptionalNullableString(options.chatId),
    backgroundMode: readBackgroundMode(options.backgroundMode),
    width: clampWindowSize(
      options.width,
      defaultSize.width,
      MIN_PIP_WIDTH,
      MAX_PIP_WIDTH,
    ),
    height: clampWindowSize(
      options.height,
      defaultSize.height,
      MIN_PIP_HEIGHT,
      MAX_PIP_HEIGHT,
    ),
  };
}

function normalizeRuntimeMessage(value: unknown): DesktopPipRuntimeMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected PiP runtime message");
  }
  const message = value as Record<string, unknown>;
  if (
    message.type !== "ready" &&
    message.type !== "snapshot" &&
    message.type !== "incremental" &&
    message.type !== "camera-preset" &&
    message.type !== "voice" &&
    message.type !== "voice-command"
  ) {
    throw new Error("Expected valid PiP runtime message type");
  }
  if (
    typeof message.sequence !== "number" ||
    !Number.isFinite(message.sequence)
  ) {
    throw new Error("Expected finite PiP runtime message sequence");
  }
  if (
    typeof message.sentAtMs !== "number" ||
    !Number.isFinite(message.sentAtMs)
  ) {
    throw new Error("Expected finite PiP runtime message sentAtMs");
  }
  const normalized: DesktopPipRuntimeMessage = {
    type: message.type,
    sequence: Math.max(0, Math.round(message.sequence)),
    sentAtMs: message.sentAtMs,
    animaId: readAnimaId(message.animaId),
    payload: message.payload,
  };
  if (!canCloneRuntimeMessage(normalized)) {
    throw new Error("PiP runtime message is not cloneable");
  }
  return normalized;
}

export class PipWindowManager {
  private readonly config: DesktopConfig;
  private readonly locale: ShellLocale;
  private readonly cursorSnapshotChannel: string;
  private readonly preloadPath: string;
  private readonly runtimeMessageChannel: string;
  private readonly stateChangedChannel: string;
  private readonly clickThroughSupported = process.platform !== "linux";
  private ownerContents: WebContents | null = null;
  /** Owners already watched for destruction; each needs one listener, not one per PiP window. */
  private readonly ownersWatchedForDestroy = new Set<number>();
  private mousePoll: ReturnType<typeof setInterval> | null = null;
  private pipMouseEventsIgnored = false;
  private pipWindow: BrowserWindow | null = null;
  private pipRuntimeStateReady = false;
  private pipRendererReady = false;
  /** Follows the cursor while the route's resize grip is held. */
  private gripResizeTimer: ReturnType<typeof setInterval> | null = null;
  private state: DesktopPipState = {
    isOpen: false,
    animaId: null,
    chatId: null,
    backgroundMode: DEFAULT_BACKGROUND_MODE,
    isHovered: false,
    sizeScale: DEFAULT_PIP_SIZE_SCALE,
  };

  constructor(options: PipWindowManagerOptions) {
    this.config = options.config;
    this.locale = options.locale;
    this.cursorSnapshotChannel = options.cursorSnapshotChannel;
    this.preloadPath = options.preloadPath;
    this.runtimeMessageChannel = options.runtimeMessageChannel;
    this.stateChangedChannel = options.stateChangedChannel;
  }

  getState(): DesktopPipState {
    return { ...this.state };
  }

  async open(
    ownerContents: WebContents,
    rawOptions: unknown,
  ): Promise<DesktopPipState> {
    const options = normalizeOpenOptions(rawOptions);
    this.ownerContents = ownerContents;
    this.closePipWhenOwnerDestroyed(ownerContents);

    this.state = {
      isOpen: true,
      animaId: options.animaId,
      chatId: options.chatId,
      backgroundMode: options.backgroundMode,
      isHovered: false,
      sizeScale: resolveSizeScaleForWindowSize(options.width, options.height),
    };

    if (this.pipWindow?.isDestroyed() === false) {
      this.startMouseTracking(this.pipWindow);
      this.resetPipReadiness();
      this.setPipMouseEventsIgnored(this.pipWindow, false);
      this.pipWindow.hide();
      this.setPipWindowDefaultBounds(
        this.pipWindow,
        ownerContents,
        this.state.sizeScale,
      );
      await this.loadPipRoute(this.pipWindow, options.animaId, options.chatId);
      this.syncPipWindowVisibility(this.pipWindow);
      if (this.pipWindow.isVisible()) {
        this.pipWindow.focus();
      }
      this.sendStateChanged();
      return this.getState();
    }

    const initialBounds = resolveDefaultPipBounds(
      ownerContents,
      options.width,
      options.height,
    );

    const pipWindow = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: options.width,
      height: options.height,
      minWidth: MIN_PIP_WIDTH,
      minHeight: MIN_PIP_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      show: false,
      type: "toolbar",
      title: this.locale.strings.text("windows.pip"),
      webPreferences: {
        preload: this.preloadPath,
        additionalArguments: ["--animama-window-role=pip"],
        partition: this.config.sessionPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.pipWindow = pipWindow;
    keepLocalizedTitle(pipWindow, this.locale, "windows.pip");
    installWindowGuards(pipWindow, this.config.allowedWebOrigin);
    pipWindow.setAlwaysOnTop(true, "floating");
    pipWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.startMouseTracking(pipWindow);

    const syncVisibility = () => {
      if (
        !isPipRouteUrl(
          pipWindow.webContents.getURL(),
          this.config.allowedWebOrigin,
        )
      ) {
        this.resetPipReadiness();
      }
      this.syncPipWindowVisibility(pipWindow);
    };

    pipWindow.webContents.on("will-navigate", () => {
      this.stopGripResize();
      this.resetPipReadiness();
      if (!pipWindow.isDestroyed() && pipWindow.isVisible()) {
        this.setPipMouseEventsIgnored(pipWindow, false);
        pipWindow.hide();
      }
    });
    pipWindow.webContents.on("did-finish-load", syncVisibility);
    pipWindow.webContents.on("did-navigate", syncVisibility);
    pipWindow.webContents.on("did-navigate-in-page", syncVisibility);

    const handleClosed = () => {
      if (this.pipWindow !== pipWindow) return;
      this.stopGripResize();
      this.pipWindow = null;
      this.pipMouseEventsIgnored = false;
      this.stopMouseTracking();
      this.resetPipReadiness();
      this.state = {
        ...this.state,
        isOpen: false,
        isHovered: false,
      };
      this.sendStateChanged();
    };

    pipWindow.on("close", () => {
      this.setPipMouseEventsIgnored(pipWindow, false);
    });
    pipWindow.on("closed", handleClosed);
    pipWindow.on("hide", () => {
      this.stopGripResize();
      this.setPipMouseEventsIgnored(pipWindow, false);
    });
    // A release outside the window after it lost focus never reaches the grip.
    pipWindow.on("blur", () => this.stopGripResize());
    await this.loadPipRoute(pipWindow, options.animaId, options.chatId);
    this.sendStateChanged();
    return this.getState();
  }

  async toggle(
    ownerContents: WebContents,
    rawOptions: unknown,
  ): Promise<DesktopPipState> {
    if (this.state.isOpen && this.pipWindow && !this.pipWindow.isDestroyed()) {
      return this.close();
    }
    return this.open(ownerContents, rawOptions);
  }

  close(): DesktopPipState {
    this.stopGripResize();
    const window = this.pipWindow;
    if (window && !window.isDestroyed()) {
      this.setPipMouseEventsIgnored(window, false);
      window.close();
    } else {
      this.pipWindow = null;
      this.pipMouseEventsIgnored = false;
      this.stopMouseTracking();
      this.resetPipReadiness();
      this.state = {
        ...this.state,
        isOpen: false,
        isHovered: false,
      };
      this.sendStateChanged();
    }
    return this.getState();
  }

  setBackgroundMode(rawMode: unknown): DesktopPipState {
    const backgroundMode = readBackgroundMode(rawMode);
    this.state = {
      ...this.state,
      backgroundMode,
    };
    this.sendStateChanged();
    return this.getState();
  }

  setSizeScale(rawScale: unknown): DesktopPipState {
    const sizeScale = clampPipSizeScale(rawScale);
    this.state = {
      ...this.state,
      sizeScale,
    };

    if (this.pipWindow && !this.pipWindow.isDestroyed()) {
      this.setPipWindowSizeScale(this.pipWindow, sizeScale, true);
    }

    this.sendStateChanged();
    return this.getState();
  }

  /**
   * Starts or ends a drag of the PiP route's bottom-right resize grip. While
   * it lasts, the window keeps its top-left corner and scales so its
   * bottom-right corner follows the cursor, and mouse input stays on so the
   * release reaches the grip wherever the cursor is.
   */
  setGripResizing(sender: WebContents, rawActive: unknown): void {
    const window = this.pipWindow;
    if (
      !window ||
      window.isDestroyed() ||
      window.webContents.id !== sender.id
    ) {
      writeLog("info", "Ignored PiP resize from a renderer other than PiP");
      return;
    }
    this.stopGripResize();
    if (rawActive !== true) return;

    this.setPipMouseEventsIgnored(window, false);
    const startCursor = screen.getCursorScreenPoint();
    const startScale = this.state.sizeScale;
    this.gripResizeTimer = setInterval(() => {
      if (window.isDestroyed()) {
        this.stopGripResize();
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      const sizeScale = resolveCornerResizeScale(
        startScale,
        cursor.x - startCursor.x,
        cursor.y - startCursor.y,
      );
      if (sizeScale === this.state.sizeScale) return;
      this.state = { ...this.state, sizeScale };
      this.setPipWindowSizeScale(window, sizeScale, false);
      this.sendStateChanged();
    }, PIP_RESIZE_INTERVAL_MS);
  }

  private stopGripResize(): void {
    if (this.gripResizeTimer === null) return;
    clearInterval(this.gripResizeTimer);
    this.gripResizeTimer = null;
  }

  publishRuntimeMessage(sender: WebContents, rawMessage: unknown): void {
    const message = normalizeRuntimeMessage(rawMessage);
    if (!this.state.isOpen || !this.state.animaId) {
      return;
    }
    if (message.animaId !== this.state.animaId) {
      throw new Error("PiP runtime message anima mismatch");
    }

    const isOwnerSender = this.ownerContents?.id === sender.id;
    const isPipSender = this.pipWindow?.webContents.id === sender.id;
    if (!isOwnerSender && !isPipSender) {
      throw new Error("PiP runtime message came from an unknown renderer");
    }
    // PiP sends readiness, camera preset requests and voice commands; the
    // owner sends state.
    const fromPipOnly =
      message.type === "ready" ||
      message.type === "camera-preset" ||
      message.type === "voice-command";
    if (fromPipOnly && !isPipSender) {
      writeLog(
        "info",
        `Ignored PiP ${message.type} message from owner renderer`,
      );
      return;
    }
    if (!fromPipOnly && !isOwnerSender) {
      writeLog("info", "Ignored PiP runtime state from PiP renderer");
      return;
    }
    if (message.type === "ready") {
      if (!this.pipRendererReady) {
        writeLog("info", "PiP renderer ready");
      }
      this.pipRendererReady = true;
      if (this.pipWindow && !this.pipWindow.isDestroyed()) {
        this.syncPipWindowVisibility(this.pipWindow);
      }
    }

    const target = isPipSender
      ? this.ownerContents
      : (this.pipWindow?.webContents ?? null);
    if (isLiveWebContents(target)) {
      target.send(this.runtimeMessageChannel, message);
      // Only Avatar state can make PiP visible; voice state may arrive first.
      const isAvatarState =
        message.type === "snapshot" || message.type === "incremental";
      if (isAvatarState && this.pipRendererReady) {
        if (!this.pipRuntimeStateReady) {
          writeLog("info", "PiP initial runtime state received");
        }
        this.pipRuntimeStateReady = true;
        if (this.pipWindow && !this.pipWindow.isDestroyed()) {
          this.syncPipWindowVisibility(this.pipWindow);
        }
      }
    }
  }

  /**
   * Close PiP if the window that opened it goes away. The listener reads the
   * current PiP window when it fires, so closed PiP windows are not retained.
   */
  private closePipWhenOwnerDestroyed(ownerContents: WebContents): void {
    const ownerId = ownerContents.id;
    if (this.ownersWatchedForDestroy.has(ownerId)) return;
    this.ownersWatchedForDestroy.add(ownerId);
    ownerContents.once("destroyed", () => {
      this.ownersWatchedForDestroy.delete(ownerId);
      const pipWindow = this.pipWindow;
      if (this.ownerContents !== ownerContents || !pipWindow) return;
      if (!pipWindow.isDestroyed()) {
        this.setPipMouseEventsIgnored(pipWindow, false);
        pipWindow.close();
      }
    });
  }

  private async loadPipRoute(
    window: BrowserWindow,
    animaId: string,
    chatId: string | null,
  ): Promise<void> {
    const pipUrl = new URL(
      `/desktop/pip/${encodeURIComponent(animaId)}`,
      this.config.webUrl.origin,
    );
    pipUrl.searchParams.set("desktopPip", "1");
    if (chatId) {
      pipUrl.searchParams.set("chatId", chatId);
    }

    writeLog("info", `Loading PiP ${pipUrl.href}`);
    this.resetPipReadiness();
    if (!window.isDestroyed()) {
      this.setPipMouseEventsIgnored(window, false);
      window.hide();
    }
    await window.loadURL(pipUrl.href);
  }

  private syncPipWindowVisibility(window: BrowserWindow): void {
    syncPipWindowVisibility(
      window,
      this.config.allowedWebOrigin,
      this.canShowPipWindow(),
      () => this.setPipMouseEventsIgnored(window, false),
    );
  }

  private canShowPipWindow(): boolean {
    return this.pipRendererReady && this.pipRuntimeStateReady;
  }

  private resetPipReadiness(): void {
    this.pipRendererReady = false;
    this.pipRuntimeStateReady = false;
  }

  private setHovered(isHovered: boolean): void {
    if (this.state.isHovered === isHovered) return;
    this.state = {
      ...this.state,
      isHovered,
    };
    this.sendStateChanged();
  }

  private setPipWindowSizeScale(
    window: BrowserWindow,
    sizeScale: number,
    preserveCenter: boolean,
  ): void {
    const nextSize = resolveWindowSizeForScale(sizeScale);
    if (!preserveCenter) {
      window.setSize(nextSize.width, nextSize.height);
      return;
    }

    const bounds = window.getBounds();
    window.setBounds({
      x: Math.round(bounds.x + (bounds.width - nextSize.width) / 2),
      y: Math.round(bounds.y + (bounds.height - nextSize.height) / 2),
      width: nextSize.width,
      height: nextSize.height,
    });
  }

  private setPipWindowDefaultBounds(
    window: BrowserWindow,
    ownerContents: WebContents,
    sizeScale: number,
  ): void {
    const nextSize = resolveWindowSizeForScale(sizeScale);
    window.setBounds(
      resolveDefaultPipBounds(ownerContents, nextSize.width, nextSize.height),
    );
  }

  private setPipMouseEventsIgnored(
    window: BrowserWindow,
    ignoreMouseEvents: boolean,
  ): void {
    if (window.isDestroyed()) {
      this.pipMouseEventsIgnored = false;
      return;
    }
    if (this.pipMouseEventsIgnored === ignoreMouseEvents) return;

    if (!this.clickThroughSupported && ignoreMouseEvents) return;

    if (ignoreMouseEvents) {
      window.setIgnoreMouseEvents(true, { forward: true });
    } else {
      window.setIgnoreMouseEvents(false);
    }
    this.pipMouseEventsIgnored = ignoreMouseEvents;
  }

  private startMouseTracking(window: BrowserWindow): void {
    if (this.mousePoll !== null) return;
    this.mousePoll = setInterval(() => {
      if (window.isDestroyed() || this.pipWindow !== window) {
        if (!window.isDestroyed()) {
          this.setPipMouseEventsIgnored(window, false);
        } else {
          this.pipMouseEventsIgnored = false;
        }
        this.stopMouseTracking();
        return;
      }
      if (!window.isVisible()) {
        this.setPipMouseEventsIgnored(window, false);
        this.setHovered(false);
        return;
      }

      const cursor = screen.getCursorScreenPoint();
      const bounds = window.getBounds();
      const mouseZone = classifyPipMouseZone(cursor, bounds);
      this.sendCursorSnapshot(window, cursor, bounds);
      const resizing = this.gripResizeTimer !== null;
      this.setHovered(resizing || mouseZone !== "outside");
      this.setPipMouseEventsIgnored(
        window,
        !resizing && mouseZone === "pass-through",
      );
    }, PIP_MOUSE_POLL_INTERVAL_MS);
  }

  private stopMouseTracking(): void {
    if (this.mousePoll === null) return;
    clearInterval(this.mousePoll);
    this.mousePoll = null;
  }

  private sendStateChanged(): void {
    const state = this.getState();
    for (const contents of [
      this.ownerContents,
      this.pipWindow?.webContents ?? null,
    ]) {
      if (isLiveWebContents(contents)) {
        contents.send(this.stateChangedChannel, state);
      }
    }
  }

  private sendCursorSnapshot(
    window: BrowserWindow,
    cursor: Point,
    bounds: Bounds,
  ): void {
    if (window.isDestroyed() || !isLiveWebContents(window.webContents)) {
      return;
    }

    const snapshot: DesktopPipCursorSnapshot = {
      screen: {
        x: cursor.x,
        y: cursor.y,
      },
      pipWindow: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      local: {
        x: cursor.x - bounds.x,
        y: cursor.y - bounds.y,
      },
      isInsidePip: isPointInsideBounds(cursor, bounds),
      sentAtMs: Date.now(),
    };
    window.webContents.send(this.cursorSnapshotChannel, snapshot);
  }
}
