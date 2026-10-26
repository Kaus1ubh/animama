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

  class FakeBrowserWindow extends Emitter {
    static fromWebContents() {
      return null;
    }
    readonly webContents = new FakeWebContents();
    destroyed = false;
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
    hide() {}
    show() {}
    focus() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    setBounds() {}
    setSize() {}
    setTitle() {}
    getBounds() {
      return { x: 0, y: 0, width: 210, height: 280 };
    }
  }

  const workArea = { x: 0, y: 0, width: 1440, height: 900 };
  const cursor = { x: 0, y: 0 };
  return { FakeBrowserWindow, FakeWebContents, cursor, workArea };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workArea: fake.workArea }),
    getDisplayMatching: () => ({ workArea: fake.workArea }),
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
import { tmpdir } from "node:os";
import path from "node:path";
import { ShellLocale } from "../src/main-process/locale/shell-locale.js";
import {
  classifyPipMouseZone,
  PipWindowManager,
} from "../src/main-process/pip/pip-window-manager.js";

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
});

afterEach(() => {
  vi.useRealTimers();
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
