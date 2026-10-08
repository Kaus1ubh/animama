import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { RuntimeStatus } from "../../shared/desktop-runtime.js";
import {
  createRuntimePage,
  STARTUP_THEME,
} from "../src/main-process/runtime/recovery.js";
import {
  RuntimeIpcCallers,
  installRuntimeIpc,
  type RuntimeIpcOperations,
} from "../src/main-process/runtime/ipc.js";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) => {
      handlers.set(channel, callback);
    },
  },
}));

function caller(id: number, url: string) {
  const frame = { url };
  const contents = {
    id,
    mainFrame: frame,
    once: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
    getURL: () => frame.url,
  };
  return {
    contents,
    frame,
    window: { webContents: contents } as unknown as BrowserWindow,
    event: {
      sender: contents,
      senderFrame: frame,
    } as unknown as IpcMainInvokeEvent,
  };
}
describe("privileged runtime IPC", () => {
  let callers: RuntimeIpcCallers;
  let main: ReturnType<typeof caller>;
  let recovery: ReturnType<typeof caller>;
  let operations: RuntimeIpcOperations;
  beforeEach(() => {
    handlers.clear();
    callers = new RuntimeIpcCallers();
    main = caller(1, "http://127.0.0.1:41234/setup");
    recovery = caller(2, "data:text/html,owned-recovery");
    callers.register(main.window, "main", "http://127.0.0.1:41234");
    callers.register(recovery.window, "recovery", recovery.frame.url);
    operations = {
      status: () => ({ state: "ready", origin: "http://127.0.0.1:41234" }),
      retry: vi.fn(async () => undefined),
      openLogs: vi.fn(async () => undefined),
      quit: vi.fn(),
      credentials: () => [
        {
          provider: "openai",
          configured: false,
          updatedAt: null,
          restartRequired: false,
        },
      ],
      changeCredentials: vi.fn(async () => [
        {
          provider: "openai",
          configured: true,
          updatedAt: "2026-09-01T00:00:00Z",
          restartRequired: false,
        },
      ]),
    };
    installRuntimeIpc(callers, operations);
  });
  const invoke = (
    name: string,
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ) => handlers.get(`animama:${name}`)!(event, ...args);

  it("allows credentials only from the registered main frame, never a child frame or lookalike window", async () => {
    await expect(
      invoke("credentials:apply", main.event, [
        { provider: "openai", value: "fixture-key" },
      ]),
    ).resolves.toMatchObject([{ configured: true }]);
    const impostor = caller(1, main.frame.url);
    await expect(invoke("credentials:list", impostor.event)).rejects.toThrow(
      "ipc_caller_rejected",
    );
    await expect(
      invoke("credentials:list", {
        ...main.event,
        senderFrame: { url: main.frame.url },
      } as IpcMainInvokeEvent),
    ).rejects.toThrow("ipc_caller_rejected");
    main.frame.url = "https://hostile.invalid/";
    await expect(invoke("credentials:list", main.event)).rejects.toThrow(
      "ipc_caller_rejected",
    );
  });

  it("gives the exact recovery page recovery actions but no provider or pack access", async () => {
    await expect(
      invoke("runtime:retry", recovery.event),
    ).resolves.toBeUndefined();
    for (const operation of [
      "credentials:list",
      "feature-packs:list",
      "updates:check",
    ])
      await expect(invoke(operation, recovery.event)).rejects.toThrow(
        "ipc_caller_rejected",
      );
    recovery.frame.url = "data:text/html,another-page";
    await expect(invoke("runtime:status", recovery.event)).rejects.toThrow(
      "ipc_caller_rejected",
    );
  });

  it("validates input lengths, providers and arity before touching the vault", async () => {
    await expect(
      invoke("credentials:apply", main.event, [
        { provider: "../path", value: "fixture-key" },
      ]),
    ).rejects.toThrow("credential_provider_invalid");
    await expect(
      invoke("credentials:apply", main.event, [
        { provider: "openai", value: "x".repeat(8193) },
      ]),
    ).rejects.toThrow("credential_value_invalid");
    await expect(
      invoke(
        "credentials:apply",
        main.event,
        [{ provider: "openai" }],
        "extra",
      ),
    ).rejects.toThrow("ipc_arguments_invalid");
    expect(operations.changeCredentials).not.toHaveBeenCalled();
  });

  it("offers no single-key channel besides the validated batch", () => {
    expect(handlers.has("animama:credentials:set")).toBe(false);
    expect(handlers.has("animama:credentials:delete")).toBe(false);
    expect(
      [...handlers.keys()].filter((name) =>
        name.startsWith("animama:credentials:"),
      ),
    ).toEqual(["animama:credentials:list", "animama:credentials:apply"]);
  });

  it("applies a validated credential batch only for the registered main frame", async () => {
    const applied = vi.fn(async () => []);
    operations.changeCredentials = applied;
    await expect(
      invoke("credentials:apply", main.event, [
        { provider: "openai", value: "fixture-key" },
        {
          connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
          value: "fixture-connection-key",
        },
        { connection: "ANIMAMA_CONNECTION_C_OTHER_API_KEY" },
        {
          connection: "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY",
          value: "fixture-search-key",
        },
      ]),
    ).resolves.toEqual([]);
    expect(applied).toHaveBeenCalledWith([
      { provider: "openai", value: "fixture-key" },
      {
        connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
        value: "fixture-connection-key",
      },
      { connection: "ANIMAMA_CONNECTION_C_OTHER_API_KEY" },
      {
        connection: "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY",
        value: "fixture-search-key",
      },
    ]);
    await expect(
      invoke("credentials:apply", recovery.event, [{ provider: "openai" }]),
    ).rejects.toThrow("ipc_caller_rejected");
    for (const invalid of [
      [],
      "openai",
      [{ provider: "openai" }, { provider: "openai" }],
      [{ provider: "openai", value: "fixture-key", path: "/tmp" }],
      [{ provider: "../path" }],
      [{ provider: "openai", value: "x".repeat(8193) }],
      [{ provider: "gemini" }],
      [{ connection: "OPENAI_API_KEY", value: "fixture-key" }],
      [{ connection: "animama_connection_c1_api_key" }],
      [
        {
          provider: "openai",
          connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
        },
      ],
      [
        { connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY" },
        { connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY" },
      ],
      Array.from({ length: 9 }, (_, index) => ({
        connection: `ANIMAMA_CONNECTION_C${index}_API_KEY`,
      })),
    ])
      await expect(
        invoke("credentials:apply", main.event, invalid),
      ).rejects.toThrow(
        /credential_(changes|provider|connection|value)_invalid/,
      );
    expect(applied).toHaveBeenCalledOnce();
  });

  it("exposes unavailable future pack/update operations explicitly", async () => {
    await expect(
      invoke("feature-packs:install", main.event, "expanded-included-content"),
    ).rejects.toThrow("feature_unavailable");
    await expect(
      invoke("feature-packs:install", main.event, "../arbitrary"),
    ).rejects.toThrow("feature_pack_invalid");
    await expect(invoke("updates:check", main.event)).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("returns retained credential failure status to the replacement registered main window", async () => {
    const retained = {
      provider: "openai" as const,
      configured: true,
      updatedAt: "2026-09-01T00:00:00Z",
      restartRequired: false,
      error: "runtime_busy",
    };
    operations.credentials = () => [retained];
    const destroy = main.contents.once.mock.calls.find(
      ([name]) => name === "destroyed",
    )![1];
    destroy();
    await expect(invoke("credentials:list", main.event)).rejects.toThrow(
      "ipc_caller_rejected",
    );
    const replacement = caller(3, main.frame.url);
    callers.register(replacement.window, "main", "http://127.0.0.1:41234");
    await expect(
      invoke("credentials:list", replacement.event),
    ).resolves.toEqual([retained]);
    await expect(invoke("credentials:list", recovery.event)).rejects.toThrow(
      "ipc_caller_rejected",
    );
  });

  it("accepts no updater paths or URLs, and excludes recovery/child frames from all update commands", async () => {
    operations.checkUpdate = vi.fn(async () => ({ state: "up_to_date" }));
    operations.openBackups = vi.fn(async () => undefined);
    await expect(invoke("updates:check", main.event)).resolves.toEqual({
      state: "up_to_date",
    });
    await expect(
      invoke("runtime:open-backups", recovery.event),
    ).resolves.toBeUndefined();
    await expect(
      invoke("runtime:open-backups", recovery.event, "/tmp/arbitrary"),
    ).rejects.toThrow("ipc_arguments_invalid");
    for (const command of [
      "updates:status",
      "updates:check",
      "updates:download",
      "updates:restart",
    ]) {
      await expect(
        invoke(command, main.event, "https://hostile.invalid"),
      ).rejects.toThrow("ipc_arguments_invalid");
      await expect(invoke(command, recovery.event)).rejects.toThrow(
        "ipc_caller_rejected",
      );
      await expect(
        invoke(command, {
          ...main.event,
          senderFrame: { url: main.frame.url },
        } as IpcMainInvokeEvent),
      ).rejects.toThrow("ipc_caller_rejected");
    }
    callers.broadcastUpdate({ state: "up_to_date" });
    expect(main.contents.send).toHaveBeenCalledWith(
      "animama:updates:status-changed",
      { state: "up_to_date" },
    );
    expect(recovery.contents.send).not.toHaveBeenCalled();
  });

  it("accepts only fixed pack IDs and stops progress delivery after renderer destruction", async () => {
    operations.featurePacks = vi.fn(() => []);
    operations.changePack = vi.fn(async () => undefined);
    await expect(
      invoke("feature-packs:install", main.event, "expanded-included-content"),
    ).resolves.toBeUndefined();
    expect(operations.changePack).toHaveBeenCalledWith(
      "install",
      "expanded-included-content",
    );
    await expect(
      invoke(
        "feature-packs:install",
        main.event,
        "expanded-included-content",
        "https://hostile.invalid",
      ),
    ).rejects.toThrow("ipc_arguments_invalid");
    await expect(
      invoke("feature-packs:remove", main.event, {
        id: "expanded-included-content",
      }),
    ).rejects.toThrow("feature_pack_invalid");
    const status = {
      id: "expanded-included-content" as const,
      state: "downloading" as const,
      available: true,
      progress: 0.5,
    };
    callers.broadcastPack(status);
    expect(main.contents.send).toHaveBeenCalledWith(
      "animama:feature-packs:progress",
      status,
    );
    expect(recovery.contents.send).not.toHaveBeenCalled();
    const destroy = main.contents.once.mock.calls.find(
      ([name]) => name === "destroyed",
    )![1];
    destroy();
    main.contents.send.mockClear();
    callers.broadcastPack(status);
    expect(main.contents.send).not.toHaveBeenCalled();
  });

  it("does not return exception payloads or broadcast after an untrusted navigation", async () => {
    operations.retry = async () => {
      throw new Error("database URL and secret must remain in main");
    };
    await expect(invoke("runtime:retry", main.event)).rejects.toThrow(
      /^runtime_start_failed$/u,
    );
    main.frame.url = "https://hostile.invalid";
    callers.broadcast({ state: "starting", stage: "backend" });
    expect(main.contents.send).not.toHaveBeenCalled();
    expect(recovery.contents.send).toHaveBeenCalledOnce();
  });
});

/** Run the emitted page script without browser or Electron dependencies. */
async function loadRuntimePage(url: string, windowRole: string) {
  const elements = new Map<string, Record<string, unknown>>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector)!;
  };
  const reload = vi.fn();
  const timers: Array<() => void> = [];
  let render: ((status: RuntimeStatus) => void) | undefined;
  const location = new URL(url);
  element("body").dataset = {};
  const script = createRuntimePage().match(
    /<script nonce="[^"]+">([\s\S]*?)<\/script>/u,
  )![1]!;
  runInNewContext(script, {
    location: {
      protocol: location.protocol,
      origin: location.origin,
      reload,
    },
    document: {
      body: element("body"),
      querySelector: element,
      getElementById: (id: string) => element(`#${id}`),
    },
    setTimeout: (callback: () => void) => timers.push(callback),
    window: {
      animamaDesktop: {
        windowRole,
        runtime: {
          status: async () => ({ state: "starting", stage: "backend" }),
          onStatus: (callback: (status: RuntimeStatus) => void) => {
            render = callback;
          },
        },
      },
    },
  });
  // Include the page's initial status query.
  await Promise.resolve();
  return {
    element,
    reload,
    render: render!,
    elapse: () => timers.splice(0).forEach((callback) => callback()),
  };
}

describe("independent runtime recovery page", () => {
  it.each([
    ["http://127.0.0.1:41234", "main", false],
    ["http://127.0.0.1:41235", "main", false],
    ["http://127.0.0.1:41234", "recovery", false],
    ["data:text/html,recovery", "recovery", false],
  ])(
    "never navigates or reloads itself on readiness: %s (%s)",
    async (url, windowRole, shouldReload) => {
      const page = await loadRuntimePage(url, windowRole);
      expect(page.reload).not.toHaveBeenCalled();
      page.render({ state: "ready", origin: "http://127.0.0.1:41234" });
      expect(page.reload).toHaveBeenCalledTimes(shouldReload ? 1 : 0);
    },
  );

  it.each([
    ["database_schema_mismatch", true],
    ["content_startup_failed", false],
  ])(
    "explains %s, preserves data and names the development reset",
    async (code, retryHidden) => {
      const page = await loadRuntimePage("data:text/html,recovery", "recovery");
      page.render({ state: "error", code });
      const message = String(page.element("#message").textContent);
      expect(message).toMatch(/local data is preserved/iu);
      // Windows has no reset helper; the data folder is renamed by hand.
      expect(message).toContain(
        process.platform === "win32"
          ? "rename %LOCALAPPDATA%\\Animama"
          : "pnpm desktop:mac:reset",
      );
      expect(page.element("#code").textContent).toBe(code);
      expect(page.element("#retry").hidden).toBe(retryHidden);
    },
  );

  it("shows progress while starting, then actions once startup stalls", async () => {
    const page = await loadRuntimePage("data:text/html,recovery", "recovery");
    expect(page.element("#title").textContent).toBe("Animama");
    expect(page.element("#bar").hidden).toBe(false);
    expect(page.element("#actions").hidden).toBe(true);
    page.elapse();
    expect(page.element("#actions").hidden).toBe(false);
    expect(page.element("#retry").hidden).toBe(true);
  });

  it("replaces the progress bar with the advice and actions on error", async () => {
    const page = await loadRuntimePage("data:text/html,recovery", "recovery");
    page.render({ state: "error", code: "vault_unreadable" });
    expect(page.element("body").dataset).toEqual({ state: "error" });
    expect(page.element("#title").textContent).toBe("Animama needs attention");
    expect(page.element("#bar").hidden).toBe(true);
    expect(page.element("#detail").hidden).toBe(false);
    expect(page.element("#actions").hidden).toBe(false);
    expect(page.element("#retry").hidden).toBe(false);
  });

  it("mirrors the app theme tokens it uses", () => {
    const theme = readFileSync(
      new URL("../../packages/product-ui/src/theme.css", import.meta.url),
      "utf8",
    );
    const block = (selector: string) =>
      theme.slice(theme.indexOf(`${selector} {`)).split("}")[0]!;
    for (const [selector, tokens] of [
      [":root", STARTUP_THEME.light],
      [".dark", STARTUP_THEME.dark],
    ] as const)
      for (const [name, value] of Object.entries(tokens))
        expect(block(selector)).toContain(`--${name}: ${value};`);
  });
});
