import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readJson,
  repoRoot,
  sha256,
  sourceRoot,
  writeJson,
} from "../../scripts/runtime/common.mjs";
import {
  inventoryId,
  inventoryTree,
} from "../../scripts/runtime/inventory.mjs";
import { stageModelCandidate } from "../../scripts/runtime/model-publication.mjs";
import {
  verifyArtifactIndex,
  writeArtifactIndex,
} from "../../scripts/runtime/release-artifacts.mjs";

export const releaseModelOrigin = "https://downloads.animama.ai";
export const frozenAssetCatalog =
  "backend/_internal/animama/resources/model-assets.v1.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Tiny reviewed-shape inputs; these receipts are test fixtures, never approvals. */
export function createReleaseModelsFixture(root) {
  const runtime = path.join(root, "runtime");
  const directory = path.join(root, "publish");
  const modelRoot = path.join(root, "store");
  const manifestsDirectory = path.join(root, "inputs");
  const modelIds = ["parakeet-tdt-0.6b-v2-webgpu", "pocket-tts-voice-cloning"];
  const catalog = { schema: "animama-asset-catalog/1", assets: [] };
  for (const modelId of modelIds) {
    const tracked = readJson(
      path.join(repoRoot, "models", modelId, "manifest.json"),
    );
    const files = tracked.files.map((file) => {
      const bytes = `${modelId}:${file.path}\n`;
      return { ...file, size: Buffer.byteLength(bytes), sha256: digest(bytes) };
    });
    const manifestFile = path.join(
      manifestsDirectory,
      modelId,
      "manifest.json",
    );
    writeJson(manifestFile, {
      schema_version: 1,
      model_id: modelId,
      license: "CC-BY-4.0",
      files,
    });
    const input = path.join(modelRoot, modelId, sha256(manifestFile));
    mkdirSync(input, { recursive: true });
    for (const file of files)
      writeFileSync(path.join(input, file.path), `${modelId}:${file.path}\n`);
    const sealed = path.join(runtime, "model-manifests", `${modelId}.json`);
    mkdirSync(path.dirname(sealed), { recursive: true });
    copyFileSync(manifestFile, sealed);
    const object = (file) =>
      `${releaseModelOrigin}/models/${modelId}/${file.sha256}/${file.path}`;
    if (modelId.startsWith("parakeet")) {
      // A multi-file backend set pins the complete inventory.
      catalog.assets.push({
        id: "parakeet-stt-webgpu",
        manifest_sha256: sha256(manifestFile),
        license_ref: "CC-BY-4.0",
        files: files.map((file) => ({
          path: file.path,
          url: object(file),
          size: file.size,
          sha256: file.sha256,
        })),
      });
    } else {
      const payload = files.find((file) => file.path.endsWith(".onnx"));
      catalog.assets.push({
        id: `${modelId}-encoder`,
        url: object(payload),
        size: payload.size,
        sha256: payload.sha256,
      });
    }
    stageModelCandidate({
      modelId,
      directory: path.join(directory, "models", modelId),
      modelRoot,
      manifestFile: sealed,
    });
  }
  writeJson(path.join(runtime, frozenAssetCatalog), catalog);
  // Archive packs are deferred, but the sealed pack catalog stays bound.
  const body = {
    schema: "animama-pack-catalog/1",
    app_version: "0.1.0",
    entries: [],
    status: "no-published-packs",
  };
  const packCatalog = { id: digest(JSON.stringify(body)), ...body };
  writeJson(path.join(runtime, "pack-catalog.json"), packCatalog);
  const fixture = {
    root,
    runtime,
    directory,
    modelRoot,
    manifestsDirectory,
    modelIds,
    catalog,
    packCatalog,
  };
  resealReleaseModelsFixture(fixture);
  return fixture;
}

/** Rebuild fixture metadata to distinguish an index change from a broken signed binding. */
export function resealReleaseModelsFixture(fixture) {
  const { runtime, directory, packCatalog } = fixture;
  const files = inventoryTree(runtime);
  const manifest = {
    schema: "animama-desktop-runtime/2",
    app_version: "0.1.0",
    build_id: inventoryId(files),
    pack_catalog_id: packCatalog.id,
    files,
  };
  writeJson(path.join(runtime, "manifest.json"), manifest);
  writeJson(path.join(directory, "runtime-manifest.json"), manifest);
  copyFileSync(
    path.join(runtime, frozenAssetCatalog),
    path.join(directory, "backend-model-assets.json"),
  );
  copyFileSync(
    path.join(runtime, "pack-catalog.json"),
    path.join(directory, "pack-catalog.json"),
  );
  writeJson(path.join(directory, "signing-report.json"), {
    schema: "animama-macos-signing/1",
    app_version: manifest.app_version,
    runtime_build_id: manifest.build_id,
  });
  fixture.manifest = manifest;
  reindexReleaseModelsFixture(fixture);
}

export function reindexReleaseModelsFixture({ directory, manifest }) {
  return writeArtifactIndex(
    directory,
    manifest.app_version,
    [
      "runtime-manifest.json",
      "backend-model-assets.json",
      "pack-catalog.json",
      "signing-report.json",
    ],
    { runtime_build_id: manifest.build_id },
  );
}

export function scanReleaseModelsFixture({ directory, modelIds }) {
  for (const folder of [
    directory,
    ...modelIds.map((id) => path.join(directory, "models", id)),
  ]) {
    writeJson(path.join(folder, "release-scan.json"), {
      schema: "animama-release-scan/1",
      result: "pass",
      scanner: {
        version: readJson(
          path.join(repoRoot, "scripts/repository-boundary/scanner-pins.json"),
        ).gitleaks.version,
        canary: "detected",
        config_sha256: sha256(
          path.join(sourceRoot, "release-scan.gitleaks.toml"),
        ),
      },
      files: verifyArtifactIndex(folder).files.map(({ name, sha256 }) => ({
        name,
        sha256,
      })),
    });
  }
}
