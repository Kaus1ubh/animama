import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  modelInputSpec,
  modelManifest,
  resolveModelInputs,
  verifyInputs,
} from "../scripts/runtime/optional-inputs.mjs";
import {
  readJson,
  repoRoot,
  sha256,
  writeJson,
} from "../scripts/runtime/common.mjs";
import { symlinksAvailable } from "./fixtures/symlinks.mjs";

const roots = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const digest = (data) => createHash("sha256").update(data).digest("hex");
const base = "parakeet-tdt-0.6b-v2";
const webgpu = "parakeet-tdt-0.6b-v2-webgpu";
/** A fixture copy of one tracked model manifest with its store directory populated. */
function modelFixture(root, modelRoot, modelId) {
  const directory = path.join(root, modelId);
  mkdirSync(directory);
  const manifest = readJson(
    path.join(repoRoot, "models", modelId, "manifest.json"),
  );
  const manifestFile = path.join(directory, "manifest.json");
  const data = new Map();
  for (const item of manifest.files) {
    const bytes = Buffer.from(`Reviewed fixture bytes for ${item.path}\n`);
    data.set(item.path, bytes);
    item.size = bytes.length;
    item.sha256 = digest(bytes);
    if (item.source.local)
      writeFileSync(path.join(directory, item.path), bytes);
  }
  writeJson(manifestFile, manifest);
  const source = path.join(modelRoot, manifest.model_id, sha256(manifestFile));
  mkdirSync(source, { recursive: true });
  for (const [name, bytes] of data)
    writeFileSync(path.join(source, name), bytes);
  return { manifestFile, source };
}
function fixture(modelId = base) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "animama-model-inputs-")),
  );
  roots.push(root);
  const modelRoot = path.join(root, "models");
  return {
    root,
    modelRoot,
    spec: modelInputSpec(modelId),
    ...modelFixture(root, modelRoot, modelId),
  };
}

describe("verified local model-set inputs for publication", () => {
  it("pins each tracked speech-to-text set to the exact payload the backend installs", () => {
    for (const [modelId, count] of [
      [base, 7],
      [webgpu, 3],
      ["sensevoice-small", 5],
      ["sensevoice-small-webgpu", 3],
    ]) {
      const value = fixture(modelId);
      const manifest = modelManifest(value.spec, value.manifestFile);
      expect(manifest.files).toHaveLength(count);
      expect(
        resolveModelInputs(value.spec, value.manifestFile, value.modelRoot),
      ).toBe(value.source);
      verifyInputs(value.spec, value.source, manifest);
      manifest.files.push({ ...manifest.files[0], path: "extra.onnx" });
      writeJson(value.manifestFile, manifest);
      expect(() => modelManifest(value.spec, value.manifestFile)).toThrow(
        "model manifest",
      );
    }
  });
  it.each([
    [base, "LicenseRef-FunASR-Model-License-1.1"],
    ["sensevoice-small", "CC-BY-4.0"],
  ])("rejects %s under another licence (%s)", (modelId, license) => {
    const value = fixture(modelId);
    writeJson(value.manifestFile, {
      ...readJson(value.manifestFile),
      license,
    });
    expect(() => modelManifest(value.spec, value.manifestFile)).toThrow(
      "model manifest",
    );
  });
  it.each([
    "missing",
    "corrupt",
    ...(symlinksAvailable ? ["symlink"] : []),
    "extra",
  ])("rejects %s local model inputs", (kind) => {
    const value = fixture();
    const manifest = modelManifest(value.spec, value.manifestFile);
    const file = path.join(value.source, "encoder-model.int8.onnx");
    if (kind === "missing") rmSync(file);
    if (kind === "corrupt") writeFileSync(file, "corrupt");
    if (kind === "extra")
      writeFileSync(path.join(value.source, "extra.onnx"), "unexpected");
    if (kind === "symlink") {
      rmSync(file);
      symlinkSync(path.join(value.source, "vocab.txt"), file);
    }
    expect(() => verifyInputs(value.spec, value.source, manifest)).toThrow(
      "Parakeet input",
    );
  });
  it("treats an absent default store as unavailable but an absent selected store as an error", () => {
    const value = fixture();
    vi.stubEnv("HOME", value.root);
    vi.stubEnv("XDG_CACHE_HOME", path.join(value.root, "cache"));
    vi.stubEnv("ANIMAMA_MODEL_ROOT", undefined);
    expect(resolveModelInputs(value.spec, value.manifestFile)).toBeNull();
    expect(() =>
      resolveModelInputs(
        value.spec,
        value.manifestFile,
        path.join(value.root, "absent"),
      ),
    ).toThrow("verified local inputs");
  });
  it("rejects unsafe manifest paths before resolving the store", () => {
    const value = fixture();
    const manifest = readJson(value.manifestFile);
    manifest.files[0].path = "../outside";
    writeJson(value.manifestFile, manifest);
    expect(() => modelManifest(value.spec, value.manifestFile)).toThrow(
      "Invalid Parakeet model manifest",
    );
  });
});
