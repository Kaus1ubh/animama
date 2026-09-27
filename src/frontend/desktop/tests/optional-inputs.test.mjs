import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pack } from "tar-stream";
import { stageFeaturePacks } from "../scripts/runtime/feature-packs.mjs";
import {
  auditOptionalInputs,
  stageOptionalInputs,
} from "../scripts/runtime/optional-inputs.mjs";
import {
  readJson,
  repoRoot,
  sha256,
  writeJson,
} from "../scripts/runtime/common.mjs";
import {
  buildFeaturePacks,
  inventoryPack,
} from "../scripts/runtime/feature-pack-build.js";

const roots = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const digest = (data) => createHash("sha256").update(data).digest("hex");
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
function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "animama-parakeet-stage-")),
  );
  roots.push(root);
  const modelRoot = path.join(root, "models");
  const base = modelFixture(root, modelRoot, "parakeet-tdt-0.6b-v2");
  const webgpu = modelFixture(root, modelRoot, "parakeet-tdt-0.6b-v2-webgpu");
  const target = { output: path.join(root, "stage") };
  mkdirSync(target.output);
  return {
    root,
    source: base.source,
    webgpuSource: webgpu.source,
    target,
    manifestFile: base.manifestFile,
    webgpuManifestFile: webgpu.manifestFile,
    modelRoot,
  };
}
async function writeTar(source, files, output) {
  const archive = pack();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const file of files)
    archive.entry(
      { name: file.path, mode: parseInt(file.mode, 8) },
      readFileSync(path.join(source, file.path)),
    );
  archive.finalize();
  await done;
  writeFileSync(output, Buffer.concat(chunks));
}

describe("verified local Parakeet pack inputs", () => {
  it("stages both model packs and audits independently after cache removal", async () => {
    const value = fixture();
    stageOptionalInputs(value.target, value);
    rmSync(value.source, { recursive: true });
    rmSync(value.webgpuSource, { recursive: true });
    const audited = auditOptionalInputs(value.target, value);
    const inventory = audited["parakeet-stt"];
    expect(inventory).toHaveLength(7);
    expect(
      audited["parakeet-stt-webgpu"].map((file) => [
        file.path,
        file.license_refs,
      ]),
    ).toEqual([
      ["ATTRIBUTION.md", ["parakeet-webgpu-input"]],
      ["README.md", ["parakeet-webgpu-input"]],
      ["encoder-model.fp16.onnx", ["parakeet-webgpu-input"]],
    ]);
    const webgpuFiles = await inventoryPack(
      path.join(value.target.output, "pack-inputs/parakeet-stt-webgpu"),
      "parakeet-stt-webgpu",
    );
    expect(webgpuFiles.map((file) => file.path)).toEqual([
      "ATTRIBUTION.md",
      "README.md",
      "encoder-model.fp16.onnx",
    ]);
    const files = await inventoryPack(
      path.join(value.target.output, "pack-inputs/parakeet-stt"),
      "parakeet-stt",
    );
    expect(files.map((file) => file.path)).toEqual(
      inventory.map((file) => file.path),
    );
    expect(files.map((file) => file.sha256)).toEqual(
      inventory.map((file) => file.sha256),
    );
    expect(files.map((file) => file.path)).toContain("ATTRIBUTION.md");
    expect(files.map((file) => file.path)).toContain("README.md");
  });
  it.each(["missing", "corrupt", "symlink", "extra"])(
    "rejects %s local model inputs before copying",
    (kind) => {
      const value = fixture();
      const file = path.join(value.source, "encoder-model.int8.onnx");
      if (kind === "missing") rmSync(file);
      if (kind === "corrupt") writeFileSync(file, "corrupt");
      if (kind === "extra")
        writeFileSync(path.join(value.source, "extra.onnx"), "unexpected");
      if (kind === "symlink") {
        rmSync(file);
        symlinkSync(path.join(value.source, "vocab.txt"), file);
      }
      expect(() => stageOptionalInputs(value.target, value)).toThrow();
      expect(
        existsSync(path.join(value.target.output, "optional-inputs.json")),
      ).toBe(false);
      expect(
        existsSync(path.join(value.target.output, "pack-inputs/parakeet-stt")),
      ).toBe(false);
    },
  );
  it("keeps core-only staging optional when the default store is absent", () => {
    const value = fixture();
    vi.stubEnv("HOME", value.root);
    vi.stubEnv("XDG_CACHE_HOME", path.join(value.root, "cache"));
    vi.stubEnv("ANIMAMA_MODEL_ROOT", undefined);
    stageOptionalInputs(value.target, {
      manifestFile: value.manifestFile,
      webgpuManifestFile: value.webgpuManifestFile,
    });
    expect(auditOptionalInputs(value.target, value)).toEqual({
      "parakeet-stt": [],
      "parakeet-stt-webgpu": [],
    });
    const receipt = readJson(
      path.join(value.target.output, "optional-inputs.json"),
    );
    expect(receipt.parakeet).toBe("unavailable");
    expect(receipt.parakeet_webgpu).toBe("unavailable");
    expect(() =>
      stageOptionalInputs(value.target, {
        manifestFile: value.manifestFile,
        webgpuManifestFile: value.webgpuManifestFile,
        modelRoot: path.join(value.root, "absent"),
      }),
    ).toThrow("verified local inputs");
  });
  it("fails when only the WebGPU encoder is missing from a selected store", () => {
    const value = fixture();
    rmSync(value.webgpuSource, { recursive: true });
    expect(() => stageOptionalInputs(value.target, value)).toThrow(
      "Parakeet WebGPU staging needs verified local inputs",
    );
    expect(
      existsSync(path.join(value.target.output, "optional-inputs.json")),
    ).toBe(false);
  });
  it("rejects a stale WebGPU receipt", () => {
    const value = fixture();
    stageOptionalInputs(value.target, value);
    const receiptPath = path.join(value.target.output, "optional-inputs.json");
    const receipt = readJson(receiptPath);
    receipt.parakeet_webgpu.manifest_sha256 = "0".repeat(64);
    writeJson(receiptPath, receipt);
    expect(() => auditOptionalInputs(value.target, value)).toThrow(
      "Parakeet WebGPU staged receipt differs",
    );
  });
  it("rejects missing active pack inputs before building a release catalog", async () => {
    const value = fixture();
    writeJson(path.join(value.target.output, "optional-inputs.json"), {
      schema: "animama-optional-inputs/1",
      parakeet: "unavailable",
      parakeet_webgpu: "unavailable",
    });
    await expect(stageFeaturePacks(value.target)).rejects.toThrow(
      "Active parakeet-stt pack inputs are unavailable",
    );
  });
  it("rejects unsafe manifest paths before resolving the store", () => {
    const value = fixture();
    const manifest = readJson(value.manifestFile);
    manifest.files[0].path = "../outside";
    writeJson(value.manifestFile, manifest);
    expect(() => stageOptionalInputs(value.target, value)).toThrow(
      "Invalid Parakeet model manifest",
    );
  });
  it("detects staged corruption and stale acquisition receipts", () => {
    const value = fixture();
    stageOptionalInputs(value.target, value);
    const receiptPath = path.join(value.target.output, "optional-inputs.json");
    const receipt = readJson(receiptPath);
    receipt.parakeet.manifest_sha256 = "0".repeat(64);
    writeJson(receiptPath, receipt);
    expect(() => auditOptionalInputs(value.target, value)).toThrow("receipt");
    stageOptionalInputs(value.target, value);
    writeFileSync(
      path.join(value.target.output, "pack-inputs/parakeet-stt/nemo128.onnx"),
      "changed",
    );
    expect(() => auditOptionalInputs(value.target, value)).toThrow(
      "integrity mismatch",
    );
  });
  it("keeps unreviewed inputs unpublished and round-trips the fixture-approved pack", async () => {
    const value = fixture();
    stageOptionalInputs(value.target, value);
    const input = path.join(value.target.output, "pack-inputs/parakeet-stt");
    const ids = [
      "parakeet-stt",
      "parakeet-stt-webgpu",
      "expanded-included-content",
      "document-processing",
    ];
    const options = {
      inputs: Object.fromEntries(
        ids.map((id) => [
          id,
          id === "parakeet-stt" ? input : path.join(value.root, id),
        ]),
      ),
      output: path.join(value.root, "archives"),
      catalog: path.join(value.root, "catalog.json"),
      appVersion: "0.1.0",
      release: {
        release_base_url:
          "https://github.com/example/animama/releases/download/v0.1.0",
        macos: { team_id: null, designated_requirement: null },
        packs: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              release_status: id === "parakeet-stt" ? "active" : "deferred",
              version: "0.1.0",
              approved_inventory_sha256: null,
              license_refs: ["parakeet-input"],
            },
          ]),
        ),
      },
      budgets: Object.fromEntries(
        ids.map((id) => [
          id,
          { installed_bytes: 100_000, download_bytes: null },
        ]),
      ),
      writeTar,
    };
    expect((await buildFeaturePacks(options)).entries).toEqual([]);
    const files = await inventoryPack(input, "parakeet-stt");
    // Fixture approval only; no release approval file is changed by this test.
    options.release.packs["parakeet-stt"].approved_inventory_sha256 = digest(
      JSON.stringify(files),
    );
    const built = await buildFeaturePacks(options);
    expect(built.entries).toHaveLength(1);
    expect(built.entries[0].files).toEqual(files);
    expect(built.entries[0].license_refs).toEqual(["parakeet-input"]);
    expect(built.entries[0].files).toHaveLength(7);
    expect(readJson(options.catalog).status).toBe("staged-not-published");
  });
});
