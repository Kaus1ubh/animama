import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopUpdateController,
  type UpdateAdapter,
} from "../src/main-process/updates/controller.js";
import {
  allowedUpdateUrl,
  updateFreeBytes,
  validateUpdateCandidate,
  validateUpdatePolicy,
} from "../src/main-process/updates/policy.js";
import { RuntimeError } from "../src/main-process/runtime/errors.js";

const policy = {
  schema: "animama-update-policy/1" as const,
  github: { owner: "example", repo: "animama-releases" },
  channel: "stable" as const,
  team_id: "ABCDE12345",
};
const feed = () => ({
  version: "0.2.0",
  tag: "v0.2.0",
  minimumSystemVersion: "24.0.0",
  files: [
    {
      url: "Animama-0.2.0-arm64.zip",
      size: 1000,
      sha512: Buffer.alloc(64).toString("base64"),
    },
  ],
  animama: {
    schema: "animama-update/1",
    platform: "darwin",
    architecture: "arm64",
    installed_bytes: 5000,
    runtime_build_id: "a".repeat(64),
    packs: [],
  },
});
function controller() {
  const adapter: UpdateAdapter = {
    check: vi.fn(async () => ({ available: true, info: feed() })),
    download: vi.fn(async (_candidate, progress) => progress(500)),
    install: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const options = {
    version: "0.1.0",
    adapter,
    checkTimeoutMs: 10,
    disk: vi.fn(async () => ({ free: 10_000_000_000n, databaseBytes: 2000 })),
    preflight: vi.fn(async () => undefined),
    stopAndInstall: vi.fn(async (_candidate, install: () => Promise<void>) =>
      install(),
    ),
    onStatus: vi.fn(),
  };
  return { updates: new DesktopUpdateController(options), adapter, options };
}
afterEach(() => vi.useRealTimers());

describe("public stable macOS update policy", () => {
  it("rejects credentials, alternate channels, targets, paths and unbounded feed sizes", () => {
    expect(validateUpdatePolicy(policy)).toEqual(policy);
    expect(() =>
      validateUpdatePolicy({ ...policy, github: { repo: "releases" } }),
    ).toThrow();
    expect(() =>
      validateUpdatePolicy({ ...policy, token: "never-embedded" }),
    ).toThrow();
    for (const version of ["0.1.0", "0.0.9", "0.2.0-beta.1", "1.02.0"])
      expect(() =>
        validateUpdateCandidate(
          { ...feed(), version, tag: `v${version}` },
          "0.1.0",
        ),
      ).toThrow();
    for (const field of [
      { minimumSystemVersion: "15.0" },
      { minimumSystemVersion: "22.0.0" },
      { minimumSystemVersion: "23.0.0" },
      { tag: "latest" },
      { stagingPercentage: 10 },
      {
        files: [
          { ...feed().files[0], url: "https://hostile.invalid/update.zip" },
        ],
      },
      { animama: { ...feed().animama, architecture: "x64" } },
      { files: [{ ...feed().files[0], size: 2 ** 32 }] },
    ])
      expect(() =>
        validateUpdateCandidate({ ...feed(), ...field }, "0.1.0"),
      ).toThrow();
    expect(
      allowedUpdateUrl(
        "https://github.com/example/animama-releases/releases.atom",
        policy,
      ),
    ).toBe(true);
    for (const url of [
      "http://github.com/example/animama-releases/releases/latest",
      "https://github.com/attacker/repo/releases/latest",
      "https://github.com@example.invalid/releases",
      "https://secret@github.com/example/animama-releases/releases/latest",
      "file:///tmp/update.zip",
    ])
      expect(allowedUpdateUrl(url, policy)).toBe(false);
  });
  it("includes installed bytes, updater staging and the actual database estimate", () => {
    expect(
      updateFreeBytes(validateUpdateCandidate(feed(), "0.1.0"), 2000),
    ).toBe(2 * 1000 + 2 * 5000 + 2 * 2000 + 256 * 1024 ** 2);
  });
});

describe("consent-driven desktop updates", () => {
  it("never downloads at check time and installs only after a second preflight and service shutdown", async () => {
    const { updates, adapter, options } = controller();
    expect(await updates.check()).toMatchObject({
      state: "available",
      version: "0.2.0",
    });
    expect(adapter.download).not.toHaveBeenCalled();
    await updates.restart();
    expect(adapter.install).not.toHaveBeenCalled();
    expect(await updates.download()).toMatchObject({ state: "downloaded" });
    expect(adapter.install).not.toHaveBeenCalled();
    options.stopAndInstall.mockImplementationOnce(
      async (_candidate, install) => {
        expect(adapter.install).not.toHaveBeenCalled();
        expect(options.preflight).toHaveBeenCalledTimes(2);
        await install();
      },
    );
    await updates.restart();
    expect(adapter.install).toHaveBeenCalledOnce();
  });
  it.each(["update_pack_references_blocked", "update_pack_operation_active"])(
    "keeps the current app when preflight fails: %s",
    async (code) => {
      const { updates, adapter, options } = controller();
      await updates.check();
      options.preflight.mockRejectedValueOnce(new RuntimeError(code));
      expect(await updates.download()).toMatchObject({ state: "error", code });
      expect(adapter.download).not.toHaveBeenCalled();
      expect(options.stopAndInstall).not.toHaveBeenCalled();
    },
  );
  it("rechecks free space and compatibility after download and never applies if shutdown fails", async () => {
    const { updates, adapter, options } = controller();
    await updates.check();
    await updates.download();
    options.disk.mockResolvedValueOnce({ free: 1n, databaseBytes: 2000 });
    await updates.restart();
    expect(updates.status()).toMatchObject({
      state: "error",
      code: "update_insufficient_disk",
    });
    expect(options.stopAndInstall).not.toHaveBeenCalled();
    options.stopAndInstall.mockRejectedValueOnce(
      new RuntimeError("owned_services_stop_failed"),
    );
    await updates.restart();
    expect(adapter.install).not.toHaveBeenCalled();
  });
  it("bounds an offline startup check and returns only a safe category", async () => {
    const { updates, adapter } = controller();
    vi.mocked(adapter.check).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    expect(await updates.check()).toEqual({
      state: "error",
      code: "update_check_timeout",
      retry: "check",
    });
    vi.mocked(adapter.check).mockRejectedValueOnce(
      new Error("credential and host path"),
    );
    expect(await updates.check()).toEqual({
      state: "error",
      code: "update_check_failed",
      retry: "check",
    });
    expect(adapter.download).not.toHaveBeenCalled();
  });
  it("cancels the startup timer and cannot start a late download after quit", async () => {
    const { updates, adapter, options } = controller();
    await updates.check();
    let finish!: () => void;
    options.preflight.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const download = updates.download();
    updates.close();
    finish();
    await download;
    expect(adapter.download).not.toHaveBeenCalled();
    expect(adapter.close).toHaveBeenCalledOnce();
  });
});
