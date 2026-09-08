import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

const POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(workspaceRoot, "web", "public");
const animationManifestPath = join(
  workspaceRoot,
  "web",
  "src",
  "assets",
  "vrm",
  "animations",
  "manifest.json",
);
const maxExamples = 20;
const requiredAssets = [
  "onnx/models/parakeet-tdt-0.6b-v2/ATTRIBUTION.md",
  "onnx/models/parakeet-tdt-0.6b-v2/README.md",
  "onnx/models/parakeet-tdt-0.6b-v2/config.json",
  "onnx/models/parakeet-tdt-0.6b-v2/decoder_joint-model.int8.onnx",
  "onnx/models/parakeet-tdt-0.6b-v2/encoder-model.int8.onnx",
  "onnx/models/parakeet-tdt-0.6b-v2/nemo128.onnx",
  "onnx/models/parakeet-tdt-0.6b-v2/vocab.txt",
];

/** @param {string} dir */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (entry.isFile()) {
      yield path;
    }
  }
}

/** @param {string} path */
function isGitLfsPointer(path) {
  const stat = statSync(path);
  if (stat.size > 512) return false;
  const head = readFileSync(path, { encoding: "utf8" }).slice(0, 80);
  return head.startsWith(POINTER_PREFIX);
}

const pointers = [];
const missing = [];
const invalidAnimations = [];

for (const asset of requiredAssets) {
  const path = join(publicDir, asset);
  if (!existsSync(path)) {
    missing.push(`web/public/${asset}`);
  }
}

for (const path of walk(publicDir)) {
  if (isGitLfsPointer(path)) {
    pointers.push(relative(workspaceRoot, path));
  }
}

const animationManifest = JSON.parse(
  readFileSync(animationManifestPath, "utf8"),
);
const animationGroups = animationManifest.Animations ?? {};
for (const entries of Object.values(animationGroups)) {
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (
      !entry ||
      entry.type !== "vrma" ||
      entry.disabled === true ||
      typeof entry.file !== "string"
    ) {
      continue;
    }
    const currentPath = join(publicDir, "vrm", "animations", entry.file);
    if (!existsSync(currentPath)) {
      invalidAnimations.push(
        `${entry.file}: current canonical file is missing`,
      );
      continue;
    }
    if (!readFileSync(currentPath).subarray(0, 4).equals(Buffer.from("glTF"))) {
      invalidAnimations.push(`${entry.file}: current file is not binary GLB`);
    }
  }
}

if (
  missing.length === 0 &&
  pointers.length === 0 &&
  invalidAnimations.length === 0
) {
  console.log("Web public assets are present.");
  process.exit(0);
}

const examples = pointers.slice(0, maxExamples).map((path) => `  - ${path}`);
const hiddenCount = pointers.length - examples.length;
const missingExamples = missing
  .slice(0, maxExamples)
  .map((path) => `  - ${path}`);
const hiddenMissingCount = missing.length - missingExamples.length;

console.error(`
Web public assets are missing or are Git LFS pointer files, not real runtime
assets.

Vite serves src/frontend/web/public directly. If these files are pointers,
avatar animations, VFX, ONNX models, sounds, and images will fail at runtime
with errors like:

  Unexpected token 'v', "version ht"... is not valid JSON

Detected ${missing.length} missing required file(s):${
  missing.length > 0
    ? `\n${missingExamples.join("\n")}${hiddenMissingCount > 0 ? `\n  ...and ${hiddenMissingCount} more` : ""}`
    : " none"
}

Detected ${pointers.length} pointer file(s):${
  pointers.length > 0
    ? `\n${examples.join("\n")}${hiddenCount > 0 ? `\n  ...and ${hiddenCount} more` : ""}`
    : " none"
}

Detected ${invalidAnimations.length} invalid enabled App animation(s):${
  invalidAnimations.length > 0
    ? `\n${invalidAnimations
        .slice(0, maxExamples)
        .map((message) => `  - ${message}`)
        .join("\n")}${
        invalidAnimations.length > maxExamples
          ? `\n  ...and ${invalidAnimations.length - maxExamples} more`
          : ""
      }`
    : " none"
}

Install and pull Git LFS assets from the repo root:

  git lfs install
  git lfs pull --include="src/frontend/web/public/**"

If git-lfs is not installed on macOS:

  brew install git-lfs
  git lfs install
  git lfs pull --include="src/frontend/web/public/**"
`);

process.exit(1);
