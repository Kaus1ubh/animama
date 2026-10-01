import type { BrowserWindow, Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  closeProductSession,
  destroyProductWindows,
  installProductRequestGate,
  ProductSessionCleanup,
  validatedApplicationRoute,
} from "../src/main-process/runtime/product-windows.js";

const origin = "http://127.0.0.1:41234";

function window(url: string) {
  let destroyed = false;
  return {
    isDestroyed: () => destroyed,
    webContents: { getURL: () => url },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
  };
}

describe("independent product-window recovery", () => {
  it.each([
    "/",
    "/setup",
    "/library?section=fx",
    "/companion/c/chat?panel=memory#latest",
    "/a/companion",
  ])("remembers the validated main route %s", (route) => {
    expect(validatedApplicationRoute(origin + route, origin)).toBe(route);
  });
  it.each([
    "https://hostile.invalid/a",
    "http://127.0.0.1:41235/a",
    "http://user@127.0.0.1:41234/a",
    origin + "/_desktop/health",
    origin + "/v1/chats",
    origin + "/desktop/pip/anima",
    origin + "/api/session",
    origin + "/assets/index.js",
    origin + "/safety",
    origin + "/Safety",
    origin + "/Desktop/pip/anima",
    origin + "//evil.example/x",
    origin + "/library/%2e%2e/v1/chats",
    origin + "/%5csecret",
    origin + "/%ff",
    "data:text/html,recovery",
  ])("rejects %s as a remembered application route", (value) => {
    expect(validatedApplicationRoute(value, origin)).toBeNull();
  });
  it("destroys main, PiP and quick chat documents while preserving independent recovery", () => {
    const main = window(origin + "/companion/c/chat");
    const pip = window(origin + "/desktop/pip/companion");
    const quick = window(origin + "/desktop/quick-chat/companion");
    const recovery = window("data:text/html,recovery");
    const route = destroyProductWindows(
      [main, pip, quick, recovery] as unknown as BrowserWindow[],
      main as unknown as BrowserWindow,
      recovery as unknown as BrowserWindow,
      origin,
    );
    expect(route).toBe("/companion/c/chat");
    for (const product of [main, pip, quick])
      expect(product.destroy).toHaveBeenCalledOnce();
    expect(recovery.destroy).not.toHaveBeenCalled();
  });
  it("clears transient authority and workers without deleting persistent owner storage", async () => {
    const target = {
      cookies: { remove: vi.fn() },
      clearStorageData: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    await closeProductSession(target as unknown as Session, origin);
    expect(target.cookies.remove).toHaveBeenCalledWith(
      origin + "/",
      "animama_renderer_capability",
    );
    expect(target.clearStorageData).toHaveBeenCalledWith({
      origin,
      storages: ["serviceworkers"],
    });
    expect(target.closeAllConnections).toHaveBeenCalledOnce();
    expect(target.cookies.remove.mock.invocationCallOrder[0]).toBeLessThan(
      target.closeAllConnections.mock.invocationCallOrder[0]!,
    );
  });

  it("still destroys every product when a crashed main document cannot report its URL", () => {
    const main = window(origin + "/");
    main.webContents.getURL = () => {
      throw new Error("destroyed contents");
    };
    const pip = window(origin + "/desktop/pip/anima");
    expect(
      destroyProductWindows(
        [main, pip] as unknown as BrowserWindow[],
        main as unknown as BrowserWindow,
        undefined,
        origin,
      ),
    ).toBeNull();
    expect(main.destroy).toHaveBeenCalledOnce();
    expect(pip.destroy).toHaveBeenCalledOnce();
  });
  it("attempts cookie, worker and connection cleanup even when an earlier operation fails", async () => {
    const target = {
      cookies: {
        remove: vi.fn().mockRejectedValue(new Error("cookie failed")),
      },
      clearStorageData: vi.fn().mockRejectedValue(new Error("worker failed")),
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      closeProductSession(target as unknown as Session, origin),
    ).rejects.toThrow("renderer_cleanup_failed");
    expect(target.cookies.remove).toHaveBeenCalledOnce();
    expect(target.clearStorageData).toHaveBeenCalledOnce();
    expect(target.closeAllConnections).toHaveBeenCalledOnce();
  });
  it("keeps admission closed after failed cleanup and permits an explicit retry", async () => {
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient cleanup failure"))
      .mockResolvedValue(undefined);
    const state = new ProductSessionCleanup(cleanup);
    state.markActive();
    expect(state.blocked).toBe(false);
    const first = state.close();
    expect(state.blocked).toBe(true);
    await expect(first).rejects.toThrow("transient cleanup failure");
    expect(state.blocked).toBe(true);
    const retry = state.close();
    expect(state.blocked).toBe(true);
    await retry;
    expect(state.blocked).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(2);
    await state.close();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("cleans again when a stale asynchronous cookie write completes during cleanup", async () => {
    let finish!: () => void;
    const cleanup = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const state = new ProductSessionCleanup(cleanup);
    state.markActive();
    const closing = state.close();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    state.markActive();
    finish();
    await closing;
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(state.blocked).toBe(false);
  });
  it("blocks product HTTP/WS before readiness and during recovery without creating a new origin", () => {
    const onBeforeRequest = vi.fn();
    const target = { webRequest: { onBeforeRequest } };
    let ready = false;
    installProductRequestGate(
      target as unknown as Session,
      origin,
      () => ready,
    );
    const listener = onBeforeRequest.mock.calls[0]![1];
    const request = (url: string) => {
      const callback = vi.fn();
      listener({ url }, callback);
      return callback.mock.calls[0]![0];
    };
    for (const url of [
      origin + "/",
      "ws://127.0.0.1:41234/v1/notifications/ws",
    ])
      expect(request(url)).toEqual({ cancel: true });
    expect(request("data:text/html,recovery")).toEqual({ cancel: false });
    ready = true;
    expect(request(origin + "/")).toEqual({ cancel: false });
    ready = false;
    expect(request(origin + "/v1/chats")).toEqual({ cancel: true });
  });
});
