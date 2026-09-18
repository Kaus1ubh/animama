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

const defaultManifest = path.join(
  repoRoot,
  "models/parakeet-tdt-0.6b-v2/manifest.json",
);
const requiredNames = [
  "ATTRIBUTION.md",
  "README.md",
  "config.json",
  "decoder_joint-model.int8.onnx",
  "encoder-model.int8.onnx",
  "nemo128.onnx",
  "vocab.txt",
].sort();

/** Keep the seven-file desktop payload fixed while acquisition moves outside Git. */
function modelManifest(file) {
  const manifest = readJson(file);
  if (
    manifest.schema_version !== 1 ||
    manifest.model_id !== "parakeet-tdt-0.6b-v2" ||
    manifest.license !== "CC-BY-4.0" ||
    !Array.isArray(manifest.files) ||
    JSON.stringify(manifest.files.map((item) => item.path).sort()) !==
      JSON.stringify(requiredNames) ||
    manifest.files.some(
      (item) =>
        !Number.isSafeInteger(item.size) ||
        item.size < 1 ||
        !/^[a-f0-9]{64}$/u.test(item.sha256),
    )
  )
    throw new Error("Invalid Parakeet model manifest");
  return manifest;
}

/** Independently hash local/staged bytes; reject pointers, links and extra inputs. */
function verifyInputs(root, manifest, staged = false) {
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Parakeet input root must be a real directory");
  const names = readdirSync(root).sort();
  const expected = staged
    ? [...requiredNames, "PACK-REVIEW.txt"].sort()
    : requiredNames;
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error("Parakeet input inventory differs from its manifest");
  const inventory = manifest.files.map((item) => {
    const file = path.join(root, item.path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        `Parakeet input must be an unlinked regular file: ${item.path}`,
      );
    if (stat.size !== item.size || sha256(file) !== item.sha256)
      throw new Error(`Parakeet input integrity mismatch: ${item.path}`);
    return {
      path: item.path,
      size_bytes: item.size,
      sha256: item.sha256,
      license_refs: ["parakeet-input"],
    };
  });
  if (staged) {
    const note = lstatSync(path.join(root, "PACK-REVIEW.txt"));
    if (!note.isFile() || note.isSymbolicLink() || note.nlink !== 1)
      throw new Error("Invalid Parakeet review note");
  }
  return inventory.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/** Explicit acquisition is separate: staging only verifies the selected local store. */
export function stageOptionalInputs(
  target,
  { manifestFile = defaultManifest, modelRoot } = {},
) {
  const receipt = path.join(target.output, "optional-inputs.json");
  rmSync(receipt, { force: true });
  const manifest = modelManifest(manifestFile);
  const args = [
    path.join(repoRoot, "scripts/models/parakeet.py"),
    "path",
    "--offline",
    "--manifest",
    manifestFile,
    ...(modelRoot ? ["--root", modelRoot] : []),
  ];
  const resolved = spawnSync("python3", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (resolved.status === 2 && !modelRoot && !process.env.ANIMAMA_MODEL_ROOT) {
    rmSync(path.join(target.output, "pack-inputs/parakeet-stt"), {
      recursive: true,
      force: true,
    });
    writeJson(receipt, {
      schema: "animama-optional-inputs/1",
      parakeet: "unavailable",
      setup:
        "Run python3 scripts/models/parakeet.py acquire explicitly to stage speech pack inputs.",
      document_processing: "separate-signed-worker",
    });
    return;
  }
  if (resolved.error || resolved.status !== 0)
    throw new Error(
      "Parakeet staging needs verified local inputs. Run python3 scripts/models/parakeet.py verify to diagnose, then acquire with the selected ANIMAMA_MODEL_ROOT and restage; staging never downloads models.",
      { cause: resolved.error },
    );
  const source = resolved.stdout.trim();
  if (!path.isAbsolute(source))
    throw new Error("Invalid resolved Parakeet directory");
  verifyInputs(source, manifest);
  const parent = path.join(target.output, "pack-inputs");
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(path.join(parent, ".parakeet-stt-"));
  try {
    for (const item of manifest.files)
      copyFileSync(
        path.join(source, item.path),
        path.join(temporary, item.path),
      );
    writeFileSync(
      path.join(temporary, "PACK-REVIEW.txt"),
      "Unpublished pack input. Preserve ATTRIBUTION.md and README.md, which identify the exact INT8 model/preprocessor snapshots. Owner approval of the complete inventory remains required.\n",
    );
    normalizeTree(temporary);
    // Verify the copies too: a concurrent cache mutation must never enter a pack.
    const inventory = verifyInputs(temporary, manifest, true);
    const destination = path.join(parent, "parakeet-stt");
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
    writeJson(receipt, {
      schema: "animama-optional-inputs/1",
      parakeet: {
        manifest_sha256: sha256(manifestFile),
        declared_license: manifest.license,
        review: "pending",
        files: inventory,
      },
      document_processing: "separate-signed-worker",
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Audit remains independent of the developer cache after inputs are staged. */
export function auditOptionalInputs(
  target,
  { manifestFile = defaultManifest } = {},
) {
  const manifest = modelManifest(manifestFile);
  const receipt = readJson(path.join(target.output, "optional-inputs.json"));
  if (receipt.parakeet === "unavailable") {
    if (
      receipt.schema !== "animama-optional-inputs/1" ||
      existsSync(path.join(target.output, "pack-inputs/parakeet-stt"))
    )
      throw new Error("Unavailable Parakeet receipt has staged inputs");
    return [];
  }
  const inventory = verifyInputs(
    path.join(target.output, "pack-inputs/parakeet-stt"),
    manifest,
    true,
  );
  if (
    receipt.schema !== "animama-optional-inputs/1" ||
    receipt.parakeet?.manifest_sha256 !== sha256(manifestFile) ||
    receipt.parakeet?.declared_license !== manifest.license ||
    receipt.parakeet?.review !== "pending" ||
    JSON.stringify(receipt.parakeet?.files) !== JSON.stringify(inventory)
  )
    throw new Error(
      "Parakeet staged receipt differs from its verified manifest",
    );
  return inventory;
}
