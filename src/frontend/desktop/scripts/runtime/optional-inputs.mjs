import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { readJson, repoRoot, sha256 } from "./common.mjs";

/**
 * Tracked model sets published to R2 for the backend model-asset downloader.
 * They are never desktop packs. Each inventory comes from the selected
 * manifest, including a release's sealed copy; publication must not consult a
 * newer checkout's selection. Acquisition still validates its reviewed source,
 * and nothing here ever downloads.
 */
const modelSets = [
  {
    label: "Parakeet",
    modelId: "parakeet-tdt-0.6b-v2",
    script: "scripts/models/parakeet.py",
    // The backend set installs exactly these files (sorted).
    names: [
      "ATTRIBUTION.md",
      "README.md",
      "config.json",
      "decoder_joint-model.int8.onnx",
      "encoder-model.int8.onnx",
      "nemo128.onnx",
      "vocab.txt",
    ],
  },
  {
    label: "Parakeet WebGPU",
    modelId: "parakeet-tdt-0.6b-v2-webgpu",
    script: "scripts/models/parakeet_webgpu.py",
    names: ["ATTRIBUTION.md", "README.md", "encoder-model.fp16.onnx"],
  },
  {
    label: "Pocket TTS voice cloning",
    modelId: "pocket-tts-voice-cloning",
    script: "scripts/models/pocket_cloning.py",
  },
  {
    label: "Pocket TTS voices",
    modelId: "pocket-tts-voices",
    script: "scripts/models/pocket_voices.py",
  },
];

/** The model-store input spec for a tracked model ID, or undefined. */
export const modelInputSpec = (modelId) =>
  modelSets.find((spec) => spec.modelId === modelId);

/** Keep each set's payload fixed while acquisition stays outside Git. */
export function modelManifest(spec, file) {
  const manifest = readJson(file);
  const names = Array.isArray(manifest.files)
    ? manifest.files.map((item) => item?.path).sort()
    : [];
  if (
    manifest.schema_version !== 1 ||
    manifest.model_id !== spec.modelId ||
    manifest.license !== "CC-BY-4.0" ||
    !Array.isArray(manifest.files) ||
    names.length > 63 ||
    !names.includes("ATTRIBUTION.md") ||
    !names.includes("README.md") ||
    names.some(
      (name) =>
        typeof name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/u.test(name) ||
        [
          "manifest.json",
          "release-artifacts.json",
          "release-scan.json",
          "SHA256SUMS.txt",
        ].includes(name),
    ) ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
    (spec.names && JSON.stringify(names) !== JSON.stringify(spec.names)) ||
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

/** Independently hash local bytes; reject pointers, links and extra inputs. */
export function verifyInputs(spec, root, manifest) {
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error(`${spec.label} input root must be a real directory`);
  const names = readdirSync(root).sort();
  const expected = manifest.files.map((item) => item.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error(`${spec.label} input inventory differs from its manifest`);
  for (const item of manifest.files) {
    const file = path.join(root, item.path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        `${spec.label} input must be an unlinked regular file: ${item.path}`,
      );
    if (stat.size !== item.size || sha256(file) !== item.sha256)
      throw new Error(`${spec.label} input integrity mismatch: ${item.path}`);
  }
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
