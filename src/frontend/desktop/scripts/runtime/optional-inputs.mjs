import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  normalizeTree,
  readJson,
  repoRoot,
  sha256,
  writeJson,
} from "./common.mjs";

/**
 * Model packs whose pinned inputs live in the shared model store. Staging only
 * verifies the selected local store; acquisition is always explicit.
 */
const modelPacks = [
  {
    id: "parakeet-stt",
    receiptKey: "parakeet",
    label: "Parakeet",
    licenseRef: "parakeet-input",
    modelId: "parakeet-tdt-0.6b-v2",
    script: "scripts/models/parakeet.py",
    names: [
      "ATTRIBUTION.md",
      "README.md",
      "config.json",
      "decoder_joint-model.int8.onnx",
      "encoder-model.int8.onnx",
      "nemo128.onnx",
      "vocab.txt",
    ],
    note: "Unpublished pack input. Preserve ATTRIBUTION.md and README.md, which identify the exact INT8 model/preprocessor snapshots. Owner approval of the complete inventory remains required.\n",
  },
  {
    id: "parakeet-stt-webgpu",
    receiptKey: "parakeet_webgpu",
    label: "Parakeet WebGPU",
    licenseRef: "parakeet-webgpu-input",
    modelId: "parakeet-tdt-0.6b-v2-webgpu",
    script: "scripts/models/parakeet_webgpu.py",
    names: ["ATTRIBUTION.md", "README.md", "encoder-model.fp16.onnx"],
    note: "Unpublished pack input. Preserve ATTRIBUTION.md and README.md, which identify the exact FP16 encoder snapshot. Owner approval of the complete inventory remains required.\n",
  },
].map((spec) => ({
  ...spec,
  names: [...spec.names].sort(),
  defaultManifest: path.join(repoRoot, "models", spec.modelId, "manifest.json"),
}));

/**
 * Tracked model sets that are published to R2 for the backend downloader but are
 * never desktop packs. Their file names come from the tracked manifest, which
 * each set's acquisition script validates against its reviewed contract.
 */
const publishedModelSets = [
  {
    id: "pocket-tts-voices",
    label: "Pocket TTS voices",
    licenseRef: "browser-pocket",
    modelId: "pocket-tts-voices",
    script: "scripts/models/pocket_voices.py",
  },
].map((spec) => {
  const defaultManifest = path.join(
    repoRoot,
    "models",
    spec.modelId,
    "manifest.json",
  );
  return {
    ...spec,
    defaultManifest,
    // Read on use, so a broken manifest never breaks importing this module.
    get names() {
      return readJson(defaultManifest)
        .files.map((item) => item.path)
        .sort();
    },
  };
});

/** The model-store input spec for a tracked model ID, or undefined. */
export const modelInputSpec = (modelId) =>
  [...modelPacks, ...publishedModelSets].find(
    (spec) => spec.modelId === modelId,
  );

/** Keep each pack payload fixed while acquisition stays outside Git. */
export function modelManifest(spec, file) {
  const manifest = readJson(file);
  if (
    manifest.schema_version !== 1 ||
    manifest.model_id !== spec.modelId ||
    manifest.license !== "CC-BY-4.0" ||
    !Array.isArray(manifest.files) ||
    JSON.stringify(manifest.files.map((item) => item.path).sort()) !==
      JSON.stringify(spec.names) ||
    manifest.files.some(
      (item) =>
        !Number.isSafeInteger(item.size) ||
        item.size < 1 ||
        !/^[a-f0-9]{64}$/u.test(item.sha256),
    )
  )
    throw new Error(`Invalid ${spec.label} model manifest`);
  return manifest;
}

/** Independently hash local/staged bytes; reject pointers, links and extra inputs. */
export function verifyInputs(spec, root, manifest, staged = false) {
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error(`${spec.label} input root must be a real directory`);
  const names = readdirSync(root).sort();
  const expected = staged
    ? [...spec.names, "PACK-REVIEW.txt"].sort()
    : spec.names;
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error(`${spec.label} input inventory differs from its manifest`);
  const inventory = manifest.files.map((item) => {
    const file = path.join(root, item.path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        `${spec.label} input must be an unlinked regular file: ${item.path}`,
      );
    if (stat.size !== item.size || sha256(file) !== item.sha256)
      throw new Error(`${spec.label} input integrity mismatch: ${item.path}`);
    return {
      path: item.path,
      size_bytes: item.size,
      sha256: item.sha256,
      license_refs: [spec.licenseRef],
    };
  });
  if (staged) {
    const note = lstatSync(path.join(root, "PACK-REVIEW.txt"));
    if (!note.isFile() || note.isSymbolicLink() || note.nlink !== 1)
      throw new Error(`Invalid ${spec.label} review note`);
  }
  return inventory.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/**
 * Resolve the verified local model-store directory offline. Returns null when
 * the default store has no copy, so optional callers can skip it.
 */
export function resolveModelInputs(spec, manifestFile, modelRoot) {
  const resolved = spawnSync(
    "python3",
    [
      path.join(repoRoot, spec.script),
      "path",
      "--offline",
      "--manifest",
      manifestFile,
      ...(modelRoot ? ["--root", modelRoot] : []),
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (resolved.status === 2 && !modelRoot && !process.env.ANIMAMA_MODEL_ROOT)
    return null;
  if (resolved.error || resolved.status !== 0)
    throw new Error(
      `${spec.label} staging needs verified local inputs. Run python3 ${spec.script} verify to diagnose, then acquire with the selected ANIMAMA_MODEL_ROOT and restage; staging never downloads models.`,
      { cause: resolved.error },
    );
  const source = resolved.stdout.trim();
  if (!path.isAbsolute(source))
    throw new Error(`Invalid resolved ${spec.label} directory`);
  return source;
}

/** Stage one pack's verified inputs; returns its receipt value. */
function stageModelPack(target, spec, manifestFile, modelRoot) {
  const manifest = modelManifest(spec, manifestFile);
  const destination = path.join(target.output, "pack-inputs", spec.id);
  const source = resolveModelInputs(spec, manifestFile, modelRoot);
  if (source === null) {
    rmSync(destination, { recursive: true, force: true });
    return "unavailable";
  }
  verifyInputs(spec, source, manifest);
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(path.join(parent, `.${spec.id}-`));
  try {
    for (const item of manifest.files)
      copyFileSync(
        path.join(source, item.path),
        path.join(temporary, item.path),
      );
    writeFileSync(path.join(temporary, "PACK-REVIEW.txt"), spec.note);
    normalizeTree(temporary);
    // Verify the copies too: a concurrent cache mutation must never enter a pack.
    const inventory = verifyInputs(spec, temporary, manifest, true);
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
    return {
      manifest_sha256: sha256(manifestFile),
      declared_license: manifest.license,
      review: "pending",
      files: inventory,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Canonical producer paths are resolved before the TypeScript tool is bundled. */
export function modelPackManifestFiles(options = {}) {
  return {
    "parakeet-stt": options.manifestFile ?? modelPacks[0].defaultManifest,
    "parakeet-stt-webgpu":
      options.webgpuManifestFile ?? modelPacks[1].defaultManifest,
  };
}

/** Explicit acquisition is separate: staging only verifies the selected local store. */
export function stageOptionalInputs(target, options = {}) {
  const receipt = path.join(target.output, "optional-inputs.json");
  rmSync(receipt, { force: true });
  const manifests = modelPackManifestFiles(options);
  const value = {
    schema: "animama-optional-inputs/1",
    document_processing: "separate-signed-worker",
  };
  for (const spec of modelPacks) {
    const staged = stageModelPack(
      target,
      spec,
      manifests[spec.id] ?? spec.defaultManifest,
      options.modelRoot,
    );
    value[spec.receiptKey] = staged;
    if (staged === "unavailable")
      value[`${spec.receiptKey}_setup`] =
        `Run python3 ${spec.script} acquire explicitly to stage this pack's inputs.`;
  }
  writeJson(receipt, value);
}

/**
 * Audit remains independent of the developer cache after inputs are staged.
 * Returns each model pack's verified inventory; unavailable inputs are empty.
 */
export function auditOptionalInputs(target, options = {}) {
  const manifests = modelPackManifestFiles(options);
  const receipt = readJson(path.join(target.output, "optional-inputs.json"));
  if (receipt.schema !== "animama-optional-inputs/1")
    throw new Error("Invalid optional input receipt");
  const inventories = {};
  for (const spec of modelPacks) {
    const manifestFile = manifests[spec.id] ?? spec.defaultManifest;
    const manifest = modelManifest(spec, manifestFile);
    const recorded = receipt[spec.receiptKey];
    const input = path.join(target.output, "pack-inputs", spec.id);
    if (recorded === "unavailable") {
      if (existsSync(input))
        throw new Error(`Unavailable ${spec.label} receipt has staged inputs`);
      inventories[spec.id] = [];
      continue;
    }
    const inventory = verifyInputs(spec, input, manifest, true);
    if (
      recorded?.manifest_sha256 !== sha256(manifestFile) ||
      recorded?.declared_license !== manifest.license ||
      recorded?.review !== "pending" ||
      JSON.stringify(recorded?.files) !== JSON.stringify(inventory)
    )
      throw new Error(
        `${spec.label} staged receipt differs from its verified manifest`,
      );
    inventories[spec.id] = inventory;
  }
  return inventories;
}
