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
  schema: "animama-update-policy/2" as const,
  distribution: {
    kind: "github" as const,
    owner: "example",
    repo: "animama-releases",
  },
  channel: "stable" as const,
  team_id: "ABCDE12345",
};
const r2Policy = {
  ...policy,
  distribution: {
    kind: "r2" as const,
    base_url: "https://downloads.example.test/desktop",
  },
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
    distribution: policy.distribution,
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
    expect(validateUpdatePolicy(r2Policy)).toEqual(r2Policy);
    for (const distribution of [
      { kind: "github", repo: "releases" },
      { kind: "r2", base_url: "http://downloads.example.test/desktop" },
      { kind: "r2", base_url: "https://downloads.example.test/desktop/" },
      { kind: "r2", base_url: "https://downloads.example.test:8443/desktop" },
      { kind: "r2", base_url: "https://u@downloads.example.test/desktop" },
      { kind: "r2", base_url: "https://downloads.example.test/desktop?x=1" },
      {
        kind: "r2",
        base_url: "https://downloads.example.test/desktop",
        bucket: "b",
      },
      { kind: "s3", base_url: "https://downloads.example.test/desktop" },
      null,
    ])
      expect(() => validateUpdatePolicy({ ...policy, distribution })).toThrow(
        "updates_not_configured",
      );
    expect(() =>
      validateUpdatePolicy({
        schema: "animama-update-policy/1",
        github: { owner: "example", repo: "animama-releases" },
        channel: "stable",
        team_id: "ABCDE12345",
      }),
    ).toThrow("updates_not_configured");
    expect(() =>
      validateUpdatePolicy({ ...policy, token: "never-embedded" }),
    ).toThrow();
    for (const version of ["0.1.0", "0.0.9", "0.2.0-beta.1", "1.02.0"])
      expect(() =>
        validateUpdateCandidate(
          { ...feed(), version, tag: `v${version}` },
          "0.1.0",
          policy.distribution,
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
        validateUpdateCandidate(
          { ...feed(), ...field },
          "0.1.0",
          policy.distribution,
        ),
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
      // A GitHub build never contacts R2.
      "https://downloads.example.test/desktop/latest-mac.yml",
      "file:///tmp/update.zip",
    ])
      expect(allowedUpdateUrl(url, policy)).toBe(false);
  });
  it("confines an R2 updater to the feed and versioned folders under its base URL", () => {
    const base = "https://downloads.example.test/desktop";
    for (const url of [
      `${base}/latest-mac.yml`,
      `${base}/latest-mac.yml?noCache=1j2k3l4m`,
      `${base}/v0.2.0/Animama-0.2.0-arm64.zip`,
    ])
      expect(allowedUpdateUrl(url, r2Policy)).toBe(true);
    for (const url of [
      `${base}/latest-mac.yml?token=secret`,
      `${base}/v0.2.0/Animama-0.2.0-arm64.zip?x=1`,
      `${base}/v0.2.0/nested/Animama-0.2.0-arm64.zip`,
      `${base}/other.yml`,
      `${base}/../latest-mac.yml`,
      "https://downloads.example.test/latest-mac.yml",
      "https://downloads.example.test/desktop-evil/latest-mac.yml",
      "https://evil.example.test/desktop/latest-mac.yml",
      "http://downloads.example.test/desktop/latest-mac.yml",
      "https://downloads.example.test:8443/desktop/latest-mac.yml",
      "https://github.com/example/animama-releases/releases.atom",
      "https://release-assets.githubusercontent.com/any",
    ])
      expect(allowedUpdateUrl(url, r2Policy)).toBe(false);
  });
  it("requires each distribution's own archive location in the feed", () => {
    const r2Feed = {
      ...feed(),
      files: [{ ...feed().files[0], url: "v0.2.0/Animama-0.2.0-arm64.zip" }],
    };
    expect(
      validateUpdateCandidate(r2Feed, "0.1.0", r2Policy.distribution).filename,
    ).toBe("Animama-0.2.0-arm64.zip");
    expect(() =>
      validateUpdateCandidate(feed(), "0.1.0", r2Policy.distribution),
    ).toThrow("update_metadata_invalid");
    expect(() =>
      validateUpdateCandidate(r2Feed, "0.1.0", policy.distribution),
    ).toThrow("update_metadata_invalid");
    expect(() =>
      validateUpdateCandidate(
        {
          ...r2Feed,
          files: [
            { ...r2Feed.files[0], url: "v0.3.0/Animama-0.2.0-arm64.zip" },
          ],
        },
        "0.1.0",
        r2Policy.distribution,
      ),
    ).toThrow("update_metadata_invalid");
  });
  it("includes installed bytes, updater staging and the actual database estimate", () => {
    expect(
      updateFreeBytes(
        validateUpdateCandidate(feed(), "0.1.0", policy.distribution),
        2000,
      ),
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
