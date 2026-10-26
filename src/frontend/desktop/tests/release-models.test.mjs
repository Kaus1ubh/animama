import { afterEach, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readJson,
  repoRoot,
  sha256,
  writeJson,
} from "../scripts/runtime/common.mjs";
import {
  planReleaseModels,
  releaseModelCandidates,
  sealReleaseModelManifests,
  stageReleaseModels,
} from "../scripts/runtime/release-models.mjs";
import {
  createReleaseModelsFixture,
  frozenAssetCatalog,
  reindexReleaseModelsFixture,
  releaseModelOrigin as origin,
  resealReleaseModelsFixture,
  scanReleaseModelsFixture,
} from "./fixtures/release-models.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-release-models-"));
  roots.push(root);
  return root;
}
const fixture = () => createReleaseModelsFixture(temporary());

it("seals only model metadata from the actual frozen backend catalog", () => {
  const f = fixture();
  rmSync(path.join(f.runtime, "model-manifests"), { recursive: true });
  rmSync(f.modelRoot, { recursive: true });
  expect(
    sealReleaseModelManifests({
      runtime: f.runtime,
      manifestsDirectory: f.manifestsDirectory,
    }),
  ).toEqual(f.modelIds);
  expect(readdirSync(path.join(f.runtime, "model-manifests")).sort()).toEqual(
    f.modelIds.map((id) => `${id}.json`),
  );
  for (const id of f.modelIds)
    expect(sha256(path.join(f.runtime, "model-manifests", `${id}.json`))).toBe(
      sha256(path.join(f.manifestsDirectory, id, "manifest.json")),
    );
});

it("stages the exact signed runtime's models offline and returns only the added flat metadata", () => {
  const f = fixture();
  rmSync(path.join(f.directory, "models"), { recursive: true });
  expect(stageReleaseModels(f)).toEqual(["backend-model-assets.json"]);
  expect(
    releaseModelCandidates({ directory: f.directory, origin }).map(
      (model) => model.modelId,
    ),
  ).toEqual(f.modelIds);
  expect(() => planReleaseModels({ directory: f.directory, origin })).toThrow(
    /scan/u,
  );
  scanReleaseModelsFixture(f);
  expect(
    planReleaseModels({ directory: f.directory, origin }).map(
      (model) => model.modelId,
    ),
  ).toEqual(f.modelIds);
});

it.each(["backend-model-assets.json", "pack-catalog.json"])(
  "rejects %s changed after signing even with a fresh artifact index",
  (name) => {
    const f = fixture();
    const value = readJson(path.join(f.directory, name));
    value.changed = true;
    writeJson(path.join(f.directory, name), value);
    reindexReleaseModelsFixture(f);
    expect(() =>
      releaseModelCandidates({ directory: f.directory, origin }),
    ).toThrow(/sealed|binding/u);
  },
);

it("rejects a signing report for another runtime", () => {
  const f = fixture();
  writeJson(path.join(f.directory, "signing-report.json"), {
    schema: "animama-macos-signing/1",
    app_version: "0.1.0",
    runtime_build_id: "a".repeat(64),
  });
  reindexReleaseModelsFixture(f);
  expect(() =>
    releaseModelCandidates({ directory: f.directory, origin }),
  ).toThrow(/identity|binding/u);
});

it.each(["missing", "extra"])("rejects %s staged model sets", (change) => {
  const f = fixture();
  if (change === "missing")
    rmSync(path.join(f.directory, "models", f.modelIds[0]), {
      recursive: true,
    });
  else mkdirSync(path.join(f.directory, "models", "unreferenced-set"));
  expect(() =>
    releaseModelCandidates({ directory: f.directory, origin }),
  ).toThrow(/membership|binding/u);
});

it("rejects an extra sealed manifest not referenced by the backend catalog", () => {
  const f = fixture();
  copyFileSync(
    path.join(f.runtime, "model-manifests", `${f.modelIds[0]}.json`),
    path.join(f.runtime, "model-manifests", "extra.json"),
  );
  resealReleaseModelsFixture(f);
  expect(() =>
    releaseModelCandidates({ directory: f.directory, origin }),
  ).toThrow(/membership/u);
});

it("rejects a candidate manifest whose inventory no longer matches the signed runtime", () => {
  const f = fixture();
  const file = path.join(f.directory, "models", f.modelIds[1], "manifest.json");
  writeFileSync(file, `${JSON.stringify(readJson(file))} `);
  expect(() =>
    releaseModelCandidates({ directory: f.directory, origin }),
  ).toThrow(/sealed|binding/u);
});

it("validates every model inventory and scan before yielding a publication plan", () => {
  const f = fixture();
  scanReleaseModelsFixture(f);
  const last = path.join(f.directory, "models", f.modelIds[1]);
  const receipt = readJson(path.join(last, "release-scan.json"));
  receipt.files[0].sha256 = "a".repeat(64);
  writeJson(path.join(last, "release-scan.json"), receipt);
  expect(() => planReleaseModels({ directory: f.directory, origin })).toThrow(
    /scan/u,
  );
  writeFileSync(path.join(last, "mimi_encoder.onnx"), "changed");
  expect(() =>
    releaseModelCandidates({ directory: f.directory, origin }),
  ).toThrow(/candidate|inventory/u);
});

function currentRuntime(editCatalog = (catalog) => catalog) {
  const runtime = path.join(temporary(), "runtime");
  writeJson(
    path.join(runtime, frozenAssetCatalog),
    editCatalog(
      readJson(
        path.join(
          repoRoot,
          "src/backend/animama/resources/model-assets.v1.json",
        ),
      ),
    ),
  );
  return runtime;
}

it("derives all six current published model sets from the backend catalog alone", () => {
  expect(sealReleaseModelManifests({ runtime: currentRuntime() })).toEqual([
    "parakeet-tdt-0.6b-v2",
    "parakeet-tdt-0.6b-v2-webgpu",
    "pocket-tts-voice-cloning",
    "pocket-tts-voices",
    "sensevoice-small",
    "sensevoice-small-webgpu",
  ]);
});

it("refuses a backend asset set that is not its complete tracked manifest", () => {
  const runtime = currentRuntime((catalog) => {
    const gpu = catalog.assets.find(
      (asset) => asset.id === "parakeet-stt-webgpu",
    );
    gpu.files = gpu.files.filter((file) => file.path !== "README.md");
    return catalog;
  });
  expect(() => sealReleaseModelManifests({ runtime })).toThrow(
    /catalog does not match/u,
  );
});
