import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  /** Enough of Node's EventEmitter to count Electron listeners. */
  class Emitter {
    private readonly listeners = new Map<string, Array<() => void>>();
    on(event: string, listener: () => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        listener,
      ]);
      return this;
    }
    once(event: string, listener: () => void) {
      const wrapped = () => {
        this.off(event, wrapped);
        listener();
      };
      return this.on(event, wrapped);
    }
    off(event: string, listener: () => void) {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((entry) => entry !== listener),
      );
      return this;
    }
    emit(event: string) {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
    listenerCount(event: string) {
      return this.listeners.get(event)?.length ?? 0;
    }
  }

  let nextId = 1;
  class FakeWebContents extends Emitter {
    readonly id = nextId++;
    url = "";
    send = vi.fn();
    getURL() {
      return this.url;
    }
    isDestroyed() {
      return false;
    }
  }

  type Bounds = { x: number; y: number; width: number; height: number };

  class FakeBrowserWindow extends Emitter {
    static fromWebContents() {
      return null;
    }
    readonly webContents = new FakeWebContents();
    destroyed = false;
    bounds: Bounds;
    constructor(options: Bounds) {
      super();
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return false;
    }
    async loadURL(url: string) {
      this.webContents.url = url;
    }
    close() {
      this.emit("close");
      this.destroyed = true;
      this.emit("closed");
    }
    /** As on quit: no `close` event, only `closed`. */
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    hide() {}
    show() {}
    focus() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    /** Electron reports programmatic moves as well as the owner's. */
    setBounds(bounds: Bounds) {
      this.bounds = { ...bounds };
      this.emit("move");
    }
    setSize() {}
    setTitle() {}
    getBounds() {
      return { ...this.bounds };
    }
    /** The owner drags the window. */
    moveTo(x: number, y: number) {
      this.bounds = { ...this.bounds, x, y };
      this.emit("move");
    }
  }

  const workArea = { x: 0, y: 0, width: 1440, height: 900 };
  const displays = [{ id: 1, workArea }];
  const cursor = { x: 0, y: 0 };
  return { FakeBrowserWindow, FakeWebContents, cursor, displays, workArea };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => fake.displays[0],
    getAllDisplays: () => fake.displays,
    getDisplayMatching: () => fake.displays[0],
    getCursorScreenPoint: () => ({ ...fake.cursor }),
  },
}));
vi.mock("../src/main-process/security/guards.js", () => ({
  installWindowGuards: () => undefined,
}));
vi.mock("../src/main-process/logging.js", () => ({
  writeLog: () => undefined,
}));

import type { WebContents } from "electron";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ShellLocale } from "../src/main-process/locale/shell-locale.js";
import {
  classifyPipMouseZone,
  PipWindowManager,
} from "../src/main-process/pip/pip-window-manager.js";

/** This test's profile directory; the private-directory walk refuses links. */
let profile: string;

function manager() {
  return new PipWindowManager({
    config: {
      allowedWebOrigin: "http://localhost:8000",
      loadTimeoutMs: 1000,
      sessionPartition: "persist:test",
      webUrl: new URL("http://localhost:8000"),
    },
    cursorSnapshotChannel: "pip:cursor",
    // No cached locale: the shell follows the (English) system languages.
    locale: new ShellLocale(
      path.join(tmpdir(), `animama-pip-test-${process.pid}-ui-locale.json`),
      () => ["en-US"],
    ),
    placementFile: path.join(profile, "pip-placement.json"),
    preloadPath: "/preload.cjs",
    runtimeMessageChannel: "pip:runtime",
    stateChangedChannel: "pip:state",
  });
}

function pipWindowOf(pip: PipWindowManager) {
  return (
    pip as unknown as {
      pipWindow: InstanceType<typeof fake.FakeBrowserWindow>;
    }
  ).pipWindow;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.cursor.x = 0;
  fake.cursor.y = 0;
  fake.displays.splice(0, fake.displays.length, {
    id: 1,
    workArea: fake.workArea,
  });
  profile = mkdtempSync(path.join(realpathSync(tmpdir()), "animama-pip-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(profile, { recursive: true, force: true });
});

describe("PipWindowManager", () => {
  it("keeps one owner listener however many PiP windows open and close", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();

    for (let cycle = 0; cycle < 12; cycle += 1) {
      await pip.open(owner as unknown as WebContents, { animaId: "annie" });
      pip.close();
    }

    expect(owner.listenerCount("destroyed")).toBe(1);
    expect(pip.getState().isOpen).toBe(false);
  });

  it("still closes an open PiP window when its owner is destroyed", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    pip.close();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });

    owner.emit("destroyed");

    expect(pip.getState().isOpen).toBe(false);
  });

  it("closes PiP only for the window that currently owns it", async () => {
    const pip = manager();
    const former = new fake.FakeWebContents();
    const current = new fake.FakeWebContents();
    await pip.open(former as unknown as WebContents, { animaId: "annie" });
    // A second window takes over the live PiP window.
    await pip.open(current as unknown as WebContents, { animaId: "annie" });

    former.emit("destroyed");
    expect(pip.getState().isOpen).toBe(true);

    current.emit("destroyed");
    expect(pip.getState().isOpen).toBe(false);
  });

  it("passes camera preset requests from PiP to its owner only", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    const pipContents = pipWindowOf(pip).webContents;
    const request = {
      type: "camera-preset",
      sequence: 0,
      sentAtMs: 1,
      animaId: "annie",
      payload: { kind: "camera-preset", preset: "full-body" },
    };

    pip.publishRuntimeMessage(pipContents as unknown as WebContents, request);
    expect(owner.send).toHaveBeenCalledWith(
      "pip:runtime",
      expect.objectContaining({ type: "camera-preset" }),
    );

    // The owner sets the preset itself; it never asks PiP for one.
    pipContents.send.mockClear();
    pip.publishRuntimeMessage(owner as unknown as WebContents, request);
    expect(pipContents.send).not.toHaveBeenCalled();
  });

  it("relays voice state from the owner and voice commands from PiP, one way each", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    const pipContents = pipWindowOf(pip).webContents;
    const message = (type: string, payload: unknown) => ({
      type,
      sequence: 1,
      sentAtMs: 1,
      animaId: "annie",
      payload,
    });
    const voice = message("voice", { activeMode: "voice" });
    const command = message("voice-command", { command: "toggle-voice-mute" });

    pip.publishRuntimeMessage(owner as unknown as WebContents, voice);
    expect(pipContents.send).toHaveBeenCalledWith(
      "pip:runtime",
      expect.objectContaining({ type: "voice" }),
    );
    pip.publishRuntimeMessage(pipContents as unknown as WebContents, command);
    expect(owner.send).toHaveBeenCalledWith(
      "pip:runtime",
      expect.objectContaining({ type: "voice-command" }),
    );

    // PiP never reports voice state, and the owner never sends PiP commands.
    owner.send.mockClear();
    pipContents.send.mockClear();
    pip.publishRuntimeMessage(pipContents as unknown as WebContents, voice);
    pip.publishRuntimeMessage(owner as unknown as WebContents, command);
    expect(owner.send).not.toHaveBeenCalled();
    expect(pipContents.send).not.toHaveBeenCalled();
  });

  it("shows PiP after the first Avatar snapshot, not after voice state", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    const window = pipWindowOf(pip);
    const show = vi.spyOn(window, "show");
    const message = (type: string) => ({
      type,
      sequence: 1,
      sentAtMs: 1,
      animaId: "annie",
      payload: null,
    });

    pip.publishRuntimeMessage(
      window.webContents as unknown as WebContents,
      message("ready"),
    );
    pip.publishRuntimeMessage(
      owner as unknown as WebContents,
      message("voice"),
    );
    expect(show).not.toHaveBeenCalled();

    pip.publishRuntimeMessage(
      owner as unknown as WebContents,
      message("snapshot"),
    );
    expect(show).toHaveBeenCalledOnce();
  });

  it("scales from the top-left corner while PiP holds its resize grip", async () => {
    const pip = manager();
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    const pipWindow = pipWindowOf(pip);
    const setSize = vi.spyOn(pipWindow, "setSize");
    const pipContents = pipWindow.webContents as unknown as WebContents;

    // The owner cannot start a resize.
    pip.setGripResizing(owner as unknown as WebContents, true);
    fake.cursor.x = 84;
    vi.advanceTimersByTime(20);
    expect(setSize).not.toHaveBeenCalled();

    pip.setGripResizing(pipContents, true);
    // Along the window's diagonal: 0.2 of the default 420 x 560.
    fake.cursor.x += 84;
    fake.cursor.y += 112;
    vi.advanceTimersByTime(20);
    expect(pip.getState().sizeScale).toBeCloseTo(0.7);
    expect(setSize).toHaveBeenLastCalledWith(294, 392);

    pip.setGripResizing(pipContents, false);
    fake.cursor.x += 84;
    vi.advanceTimersByTime(20);
    expect(pip.getState().sizeScale).toBeCloseTo(0.7);
    expect(setSize).toHaveBeenCalledTimes(1);
  });
});

describe("PiP placement", () => {
  async function openPip(pip: PipWindowManager) {
    const owner = new fake.FakeWebContents();
    await pip.open(owner as unknown as WebContents, { animaId: "annie" });
    return pipWindowOf(pip);
  }

  it("first opens flush with the bottom-right corner of the work area", async () => {
    const pipWindow = await openPip(manager());
    expect(pipWindow.getBounds()).toEqual({
      x: 1230,
      y: 620,
      width: 210,
      height: 280,
    });
  });

  it("reopens where the owner left it, after a restart too", async () => {
    const pip = manager();
    let pipWindow = await openPip(pip);
    pipWindow.moveTo(100, 150);
    vi.advanceTimersByTime(600);
    pip.setSizeScale(0.7);
    vi.advanceTimersByTime(600);
    const moved = pipWindow.getBounds();
    pip.close();

    pipWindow = await openPip(pip);
    expect(pipWindow.getBounds()).toEqual(moved);

    // A new manager reads the placement this machine saved.
    const restarted = manager();
    pipWindow = await openPip(restarted);
    expect(pipWindow.getBounds()).toEqual(moved);
    expect(restarted.getState().sizeScale).toBeCloseTo(0.7);
  });

  it("keeps a move made just before closing", async () => {
    const pip = manager();
    const pipWindow = await openPip(pip);
    pipWindow.moveTo(40, 60);
    pip.close();

    const reopened = await openPip(manager());
    expect(reopened.getBounds()).toMatchObject({ x: 40, y: 60 });
  });

  it("keeps a move made just before the app quits", async () => {
    const pip = manager();
    const pipWindow = await openPip(pip);
    pipWindow.moveTo(40, 60);
    pipWindow.destroy();

    const reopened = await openPip(manager());
    expect(reopened.getBounds()).toMatchObject({ x: 40, y: 60 });
  });

  it("returns to the corner when the saved display is disconnected", async () => {
    const pip = manager();
    const pipWindow = await openPip(pip);
    pipWindow.moveTo(100, 150);
    pip.close();

    fake.displays[0] = { id: 2, workArea: fake.workArea };
    const reopened = await openPip(manager());
    expect(reopened.getBounds()).toMatchObject({ x: 1230, y: 620 });
  });
});

describe("classifyPipMouseZone", () => {
  const bounds = { x: 100, y: 200, width: 210, height: 280 };

  it.each([
    ["outside the window", { x: 99, y: 300 }, "outside"],
    ["over the toolbar", { x: 200, y: 210 }, "interactive"],
    ["over the resize grip", { x: 300, y: 470 }, "interactive"],
    ["over the Avatar", { x: 200, y: 340 }, "pass-through"],
    ["along an edge", { x: 102, y: 340 }, "pass-through"],
  ])("classifies a cursor %s", (_case, cursor, zone) => {
    expect(classifyPipMouseZone(cursor, bounds)).toBe(zone);
  });
});
