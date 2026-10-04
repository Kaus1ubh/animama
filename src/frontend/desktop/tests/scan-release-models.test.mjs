import { afterEach, expect, it, vi } from "vitest";
import path from "node:path";
import { ScanError } from "../scripts/runtime/release-scan.mjs";

const modules = [
  "release-artifacts",
  "release-models",
  "model-publication",
  "release-scan",
];
afterEach(() => {
  for (const name of modules) vi.doUnmock(`../scripts/runtime/${name}.mjs`);
  vi.restoreAllMocks();
  vi.resetModules();
});

async function scan({
  standalone = false,
  invalid = false,
  failed = false,
} = {}) {
  const directory = path.resolve("fixture-candidate");
  const candidates = ["base", "voices"].map((id) => ({
    directory: path.join(directory, "models", id),
  }));
  const calls = [];
  vi.resetModules();
  vi.doMock("../scripts/runtime/release-artifacts.mjs", () => ({
    verifyArtifactIndex: () => (standalone ? { model_id: "base" } : {}),
  }));
  vi.doMock("../scripts/runtime/release-models.mjs", () => ({
    releaseModelCandidates: () => {
      calls.push("validate");
      if (invalid) throw new ScanError("Candidate model references changed");
      return candidates;
    },
  }));
  vi.doMock("../scripts/runtime/model-publication.mjs", () => ({
    modelDistribution: () => ({ origin: "https://downloads.example.test" }),
  }));
  vi.doMock("../scripts/runtime/release-scan.mjs", () => ({
    ScanError,
    homeDirectoryNeedles: () => [],
    scanCandidate: async (options) => {
      expect(options.gitleaks).toBe(path.resolve("fixture-gitleaks"));
      calls.push(options.directory);
      return {
        result:
          failed && options.directory === candidates[0].directory
            ? "fail"
            : "pass",
        files: [{ name: "file" }],
        findings: [],
      };
    },
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const previousArgs = process.argv;
  const previousExitCode = process.exitCode;
  process.argv = [
    process.execPath,
    "scan-release-candidate.mjs",
    "--candidate",
    directory,
    "--gitleaks",
    "fixture-gitleaks",
  ];
  process.exitCode = 0;
  try {
    await import("../scripts/runtime/scan-release-candidate.mjs");
    return { calls, directory, candidates, code: process.exitCode };
  } finally {
    process.argv = previousArgs;
    process.exitCode = previousExitCode;
  }
}

it("validates the sealed model list before scanning every dependency and the app", async () => {
  const result = await scan();
  expect(result.code).toBe(0);
  expect(result.calls).toEqual([
    "validate",
    ...result.candidates.map((item) => item.directory),
    result.directory,
  ]);
});
it("refuses a changed model list before producing any scan receipt", async () => {
  const result = await scan({ invalid: true });
  expect(result.code).toBe(1);
  expect(result.calls).toEqual(["validate"]);
});
it("an individual model finding keeps the combined scan failed", async () => {
  expect((await scan({ failed: true })).code).toBe(1);
});
it("still scans a standalone model candidate without requiring an app", async () => {
  const result = await scan({ standalone: true });
  expect(result.code).toBe(0);
  expect(result.calls).toEqual([result.directory]);
});
