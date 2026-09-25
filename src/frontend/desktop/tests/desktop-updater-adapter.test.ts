import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
import {
  createMacUpdateAdapter,
  verifyUpdaterPublisher,
} from "../src/main-process/updates/electron-adapter.js";
import { runCommand } from "../src/main-process/runtime/processes.js";
import { validateUpdateCandidate } from "../src/main-process/updates/policy.js";

// Exercise the supported-library boundary without pretending a fixture is a signed app.
const fixture = vi.hoisted(() => ({
  native: null as unknown as EventEmitter & {
    checkForUpdates: ReturnType<typeof vi.fn>;
  },
  mac: null as unknown as {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    allowDowngrade: boolean;
    logger: unknown;
    downloadUpdate(): Promise<void>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  },
  options: undefined as unknown,
  info: undefined as unknown,
  file: "",
  cancel: vi.fn(),
  beforeRequest: undefined as unknown as (
    details: { url: string },
    callback: (value: { cancel: boolean }) => void,
  ) => void,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  fixture.native = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(),
  });
  return { autoUpdater: fixture.native };
});
vi.mock("../src/main-process/runtime/processes.js", () => ({
  runCommand: vi.fn(async () => ""),
}));
vi.mock("electron-updater", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    MacUpdater: class extends EventEmitter {
      autoDownload = true;
      autoInstallOnAppQuit = true;
      allowDowngrade = true;
      logger: unknown = {};
      quitAndInstall = vi.fn();
      netSession = {
        webRequest: {
          onBeforeRequest: (callback: typeof fixture.beforeRequest) => {
            fixture.beforeRequest = callback;
          },
          onHeadersReceived: vi.fn(),
        },
      };
      constructor(options: unknown) {
        super();
        fixture.mac = this;
        fixture.options = options;
      }
      async checkForUpdates() {
        return {
          isUpdateAvailable: true,
          updateInfo: fixture.info,
          cancellationToken: { cancel: fixture.cancel },
        };
      }
      async downloadUpdate() {
        this.emit("download-progress", { transferred: 6 });
        this.emit("update-downloaded", { downloadedFile: fixture.file });
      }
    },
  };
});

const policy = {
  schema: "animama-update-policy/2" as const,
  distribution: { kind: "github" as const, owner: "example", repo: "releases" },
  channel: "stable" as const,
  team_id: "TESTTEAM01",
};
let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.native.removeAllListeners();
  root = mkdtempSync(path.join(realpathSync(tmpdir()), "animama-updater-"));
  fixture.file = path.join(root, "update.zip");
  writeFileSync(fixture.file, "zip fixture");
  fixture.info = {
    version: "0.2.0",
    tag: "v0.2.0",
    minimumSystemVersion: "24.0.0",
    files: [
      {
        url: "Animama-0.2.0-arm64.zip",
        size: 11,
        sha512: createHash("sha512").update("zip fixture").digest("base64"),
      },
    ],
    animama: {
      schema: "animama-update/1",
      platform: "darwin",
      architecture: "arm64",
      installed_bytes: 1000,
      runtime_build_id: "a".repeat(64),
      packs: [],
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe("macOS updater adapter", () => {
  it("passes a literal publisher requirement to codesign and refuses a failed signature", async () => {
    const app = path.join(root, "Animama.app");
    await verifyUpdaterPublisher(app, policy);
    expect(runCommand).toHaveBeenCalledWith(
      "/usr/bin/codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "-R",
        '=anchor apple generic and identifier "com.animama.desktop" and certificate leaf[subject.OU] = "TESTTEAM01"',
        app,
      ],
      {},
      app,
    );
    vi.mocked(runCommand).mockRejectedValueOnce(new Error("invalid signature"));
    await expect(verifyUpdaterPublisher(app, policy)).rejects.toThrow(
      "update_publisher_invalid",
    );
  });

  it("uses a public provider and does not hand a download to Squirrel until explicit install", async () => {
    const permitQuit = vi.fn();
    const adapter = createMacUpdateAdapter(policy, "0.1.0", permitQuit);
    const candidate = validateUpdateCandidate(
      fixture.info,
      "0.1.0",
      policy.distribution,
    );
    await adapter.check();
    await adapter.download(candidate, vi.fn());
    expect(fixture.options).toEqual({
      provider: "github",
      owner: "example",
      repo: "releases",
      private: false,
    });
    expect(fixture.mac).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      logger: null,
    });
    expect(fixture.native.checkForUpdates).not.toHaveBeenCalled();
    const install = adapter.install();
    expect(fixture.native.checkForUpdates).toHaveBeenCalledOnce();
    expect(permitQuit).not.toHaveBeenCalled();
    fixture.native.emit("update-downloaded");
    await install;
    expect(permitQuit).toHaveBeenCalledOnce();
    expect(fixture.mac.quitAndInstall).toHaveBeenCalledOnce();
    adapter.close();
  });
  it("uses a generic provider confined to the R2 base for an R2 build", async () => {
    const r2 = {
      ...policy,
      distribution: {
        kind: "r2" as const,
        base_url: "https://downloads.example.test/desktop",
      },
    };
    const info = fixture.info as { files: { url: string }[] };
    info.files[0].url = "v0.2.0/Animama-0.2.0-arm64.zip";
    const adapter = createMacUpdateAdapter(r2, "0.1.0", vi.fn());
    expect(fixture.options).toEqual({
      provider: "generic",
      url: "https://downloads.example.test/desktop",
    });
    const allowed = (url: string) => {
      let cancel = true;
      fixture.beforeRequest({ url }, (value) => (cancel = value.cancel));
      return !cancel;
    };
    expect(
      allowed(
        "https://downloads.example.test/desktop/latest-mac.yml?noCache=1",
      ),
    ).toBe(true);
    expect(allowed("https://github.com/example/releases/releases/latest")).toBe(
      false,
    );
    const candidate = validateUpdateCandidate(
      fixture.info,
      "0.1.0",
      r2.distribution,
    );
    await adapter.check();
    await adapter.download(candidate, vi.fn());
    expect(candidate.filename).toBe("Animama-0.2.0-arm64.zip");
  });

  it("rejects modified cache bytes and arbitrary updater hosts without exposing raw errors", async () => {
    const adapter = createMacUpdateAdapter(policy, "0.1.0", vi.fn());
    const callback = vi.fn();
    fixture.beforeRequest(
      { url: "https://hostile.invalid/update.zip" },
      callback,
    );
    expect(callback).toHaveBeenCalledWith({ cancel: true });
    writeFileSync(fixture.file, "bad fixture");
    await expect(
      adapter.download(
        validateUpdateCandidate(fixture.info, "0.1.0", policy.distribution),
        vi.fn(),
      ),
    ).rejects.toThrow("update_download_invalid");
    expect(fixture.native.checkForUpdates).not.toHaveBeenCalled();
    adapter.close();
  });
  it("does not start downloading if Quit occurs during the fresh metadata check", async () => {
    const adapter = createMacUpdateAdapter(policy, "0.1.0", vi.fn());
    const bytes = vi.spyOn(fixture.mac, "downloadUpdate");
    const download = adapter.download(
      validateUpdateCandidate(fixture.info, "0.1.0", policy.distribution),
      vi.fn(),
    );
    adapter.close();
    await expect(download).rejects.toThrow("update_download_failed");
    expect(bytes).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalled();
  });
  it("leaves native errors and late verification distinct, never approving quit after a timeout", async () => {
    vi.useFakeTimers();
    const permitQuit = vi.fn();
    const adapter = createMacUpdateAdapter(policy, "0.1.0", permitQuit);
    await adapter.download(
      validateUpdateCandidate(fixture.info, "0.1.0", policy.distribution),
      vi.fn(),
    );
    const install = adapter.install();
    const rejected = expect(install).rejects.toThrow("update_install_timeout");
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    fixture.native.emit("update-downloaded");
    expect(permitQuit).not.toHaveBeenCalled();
    expect(fixture.mac.quitAndInstall).not.toHaveBeenCalled();
    adapter.close();
  });
});
