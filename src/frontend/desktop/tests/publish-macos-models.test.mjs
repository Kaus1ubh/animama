import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublicationError } from "../scripts/runtime/publication.mjs";

const roots = [];
const modules = [
  "common",
  "release-policy",
  "release-artifacts",
  "publication",
  "publish-github",
  "publish-r2",
  "smoke-policy",
  "release-models",
  "model-publication",
];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const name of modules) vi.doUnmock(`../scripts/runtime/${name}.mjs`);
  vi.resetModules();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** Exercise the real CLI orchestration with bounded transport and evidence fixtures. */
async function runCandidate({
  kind = "r2",
  preview = true,
  invalidModel,
  failedModel,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "animama-app-model-order-"));
  roots.push(root);
  const directory = path.join(root, "release/publish");
  mkdirSync(directory, { recursive: true });
  const smoke = path.join(root, "release/smoke-name");
  mkdirSync(smoke, { recursive: true });
  for (const name of ["smoke", "network"])
    writeFileSync(path.join(smoke, `${name}-report.json`), "{}");
  const calls = [];
  const built =
    kind === "r2"
      ? { kind, base_url: "https://downloads.example.test/desktop" }
      : { kind, owner: "example", repo: "releases" };
  const index = {
    app_version: "0.2.0",
    runtime_build_id: "sealed-runtime",
    files: [{ name: "Animama-0.2.0-arm64.dmg", sha256: "fixture" }],
  };
  const dependencies = ["base", "voices", "encoder"].map((modelId) => ({
    modelId,
    directory: path.join(directory, "models", modelId),
    planned: { modelId },
  }));
  vi.resetModules();
  vi.doMock("../scripts/runtime/common.mjs", async () => ({
    ...(await vi.importActual("../scripts/runtime/common.mjs")),
    desktopRoot: root,
    sha256: () => "fixture",
    readJson: () => ({}),
  }));
  vi.doMock("../scripts/runtime/release-policy.mjs", () => ({
    loadReleasePolicy: () => ({
      version: "0.2.0",
      policy: {},
      distribution: { name: kind, ...built, bucket: "app-bucket" },
      updatePolicy: { distribution: built },
    }),
  }));
  vi.doMock("../scripts/runtime/release-artifacts.mjs", () => ({
    candidateDistribution: () => built,
    verifyArtifactIndex: () => {
      calls.push("app-index");
      return index;
    },
    writeArtifactIndex: () => index,
    previewAssets: () => index.files,
    RELEASE_TARGETS: { "darwin-arm64": { feed: "latest-mac.yml" } },
    releaseName: (_target, name) => name,
    isWindowsReleaseName: () => false,
  }));
  vi.doMock("../scripts/runtime/publication.mjs", () => ({
    PublicationError,
    verifyScanReceipt: () => calls.push("app-scan"),
  }));
  vi.doMock("../scripts/runtime/smoke-policy.mjs", () => ({
    acceptsRequiredNameSmoke: () => true,
    validateManualAcceptance: () => ({ fixture: true }),
  }));
  vi.doMock("../scripts/runtime/release-models.mjs", () => ({
    planReleaseModels: () => {
      for (const item of dependencies) {
        calls.push(`validate:${item.modelId}`);
        if (item.modelId === invalidModel)
          throw new PublicationError("Model evidence is stale");
      }
      return dependencies;
    },
  }));
  vi.doMock("../scripts/runtime/model-publication.mjs", () => ({
    modelDistribution: () => ({
      origin: "https://downloads.example.test",
      bucket: "model-bucket",
    }),
    publishModelObjects: async ({
      directory: modelDirectory,
      planned,
      bucket,
      credentials,
    }) => {
      expect(modelDirectory).toBe(
        path.join(directory, "models", planned.modelId),
      );
      expect(bucket).toBe("model-bucket");
      expect(credentials).toEqual({ fixture: true });
      calls.push(`model:${planned.modelId}`);
      if (planned.modelId === failedModel)
        throw new PublicationError("Model public verification failed");
    },
  }));
  vi.doMock("../scripts/runtime/publish-r2.mjs", () => ({
    preflightR2: async () => calls.push("preflight"),
    r2Credentials: () => {
      calls.push("credentials");
      return { fixture: true };
    },
    publishR2: async ({ preview: actual }) => {
      expect(actual).toBe(preview);
      calls.push("app:r2");
    },
  }));
  vi.doMock("../scripts/runtime/publish-github.mjs", () => ({
    preflightGithub: async () => calls.push("preflight"),
    publishGithub: async ({ preview: actual }) => {
      expect(actual).toBe(preview);
      calls.push("app:github");
    },
  }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const previousArgs = process.argv;
  const previousExitCode = process.exitCode;
  process.argv = [
    process.execPath,
    "publish-macos.mjs",
    preview ? "--confirm-preview-publication" : "--confirm-publication",
  ];
  process.exitCode = 0;
  try {
    await import("../scripts/runtime/publish-macos.mjs");
    return { calls, code: process.exitCode, errors: log.mock.calls.flat() };
  } finally {
    process.argv = previousArgs;
    process.exitCode = previousExitCode;
  }
}

describe("application release model dependencies", () => {
  it.each([
    ["r2", true],
    ["r2", false],
    ["github", true],
    ["github", false],
  ])(
    "verifies all model evidence before credentials and publishes models before %s app (preview=%s)",
    async (kind, preview) => {
      const result = await runCandidate({ kind, preview });
      expect(result.code).toBe(0);
      expect(result.calls).toEqual([
        "preflight",
        "app-index",
        "app-scan",
        "validate:base",
        "validate:voices",
        "validate:encoder",
        "credentials",
        "model:base",
        "model:voices",
        "model:encoder",
        `app:${kind}`,
      ]);
    },
  );
  it("a stale scan in the last model prevents credential reads and every upload", async () => {
    const result = await runCandidate({ invalidModel: "encoder" });
    expect(result.code).toBe(1);
    expect(result.errors).toEqual(["Model evidence is stale"]);
    expect(result.calls).not.toContain("credentials");
    expect(result.calls.some((call) => /^(model|app):/.test(call))).toBe(false);
  });
  it.each(["r2", "github"])(
    "model verification failure prevents %s app publication",
    async (kind) => {
      const result = await runCandidate({ kind, failedModel: "voices" });
      expect(result.code).toBe(1);
      expect(result.errors).toEqual(["Model public verification failed"]);
      expect(result.calls).toContain("model:base");
      expect(result.calls).not.toContain("model:encoder");
      expect(result.calls).not.toContain(`app:${kind}`);
    },
  );
});
