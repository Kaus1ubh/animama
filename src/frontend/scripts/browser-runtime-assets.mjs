import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(frontendRoot, "../..");
const defaultManifest = path.join(
  repositoryRoot,
  "models/browser-runtime/manifest.json",
);
// Reviewed inventory: generation/support files, Eve, Azelma, Michael and Smart Turn,
// plus 11 pinned package files. Other voices and Mimi install through /v1/model-assets.
const RUNTIME_FILE_COUNT = 22;
const MODEL_FILE_COUNT = 11;
const packageSources = new Map([
  ["onnxruntime-web-assets", ["onnxruntime-web", "1.24.2"]],
  ["@ricky0123/vad-web", ["@ricky0123/vad-web", "0.0.30"]],
]);
const safeRelative = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(value) &&
  value.split("/").every((part) => part && part !== "." && part !== "..");

/** Hash a bounded-memory regular file; never accept linked mutable model inputs. */
function verifyFile(file, expected, { rejectHardlinks = false } = {}) {
  const before = lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (rejectHardlinks && before.nlink !== 1) ||
    before.size !== expected.size
  )
    throw new Error(`Unsafe or wrong-sized browser runtime asset: ${file}`);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !opened.isFile()
    )
      throw new Error(
        `Browser runtime asset changed during verification: ${file}`,
      );
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    for (;;) {
      const length = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, expected.size - total + 1),
        null,
      );
      if (!length) break;
      total += length;
      if (total > expected.size)
        throw new Error(
          `Browser runtime asset grew during verification: ${file}`,
        );
      hash.update(buffer.subarray(0, length));
    }
    const after = fstatSync(fd);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      hash.digest("hex") !== expected.sha256
    )
      throw new Error(`Browser runtime asset integrity mismatch: ${file}`);
  } finally {
    closeSync(fd);
  }
}

/** Read the reviewed inventory without acquiring anything or trusting package latest. */
export function readBrowserRuntimeManifest(manifestPath = defaultManifest) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schema_version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== RUNTIME_FILE_COUNT ||
    manifest.model_manifest !== "models/browser-speech/manifest.json"
  )
    throw new Error("Invalid browser runtime manifest");
  const paths = new Set();
  for (const entry of manifest.files) {
    const source = entry.source;
    if (
      !safeRelative(entry.path) ||
      (!entry.path.startsWith("models/") && !entry.path.startsWith("ort/")) ||
      paths.has(entry.path) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !source ||
      !safeRelative(source.path)
    )
      throw new Error("Invalid browser runtime manifest entry");
    paths.add(entry.path);
    if (source.kind === "package") {
      const pin = packageSources.get(source.package);
      if (
        !pin ||
        pin[0] !== source.name ||
        pin[1] !== source.version ||
        !source.path.startsWith("dist/")
      )
        throw new Error("Unreviewed browser runtime dependency");
    } else if (source.kind !== "model-store" || source.path.includes("/")) {
      throw new Error("Invalid browser model source");
    }
  }
  return manifest;
}

/**
 * Resolve the immutable model revision once; Docker supplies its verified
 * readonly mount. Returns null only when the set was never acquired.
 */
function resolveModelDirectory() {
  const mounted = process.env.ANIMAMA_BROWSER_MODEL_DIR?.trim();
  if (mounted) {
    if (!path.isAbsolute(mounted))
      throw new Error("ANIMAMA_BROWSER_MODEL_DIR must be absolute");
    return mounted;
  }
  try {
    return execFileSync(
      process.platform === "win32" ? "python" : "python3",
      [
        path.join(repositoryRoot, "scripts/models/browser_speech.py"),
        "path",
        "--offline",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
  } catch (error) {
    if (error.status === 2) return null;
    throw error;
  }
}

/** Legacy user catalogs are separate inputs, never part of the engine manifest. */
export function isOptionalBrowserCatalog(relative) {
  return /^models\/pocket-tts\/animas\/[A-Za-z0-9_-]+_voices\.bin$/.test(
    relative,
  );
}

/** Resolve only a regular, unlinked optional catalog at its existing public URL. */
export function resolveOptionalBrowserCatalog(publicRoot, relative) {
  if (!isOptionalBrowserCatalog(relative))
    throw new Error("Invalid optional voice catalog path");
  const filePath = safeFile(path.join(publicRoot, "onnx"), relative);
  const info = lstatSync(filePath);
  if (!info.isFile() || info.nlink !== 1)
    throw new Error("Unsafe optional voice catalog");
  return { path: relative, filePath, size: info.size };
}

/** Reject unsafe source catalog links before Vite can materialize public files. */
export function verifyOptionalBrowserCatalogs(publicRoot) {
  const relative = "models/pocket-tts/animas";
  let directory;
  try {
    directory = safeFile(path.join(publicRoot, "onnx"), relative);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of readdirSync(directory))
    resolveOptionalBrowserCatalog(publicRoot, `${relative}/${name}`);
}

/** Resolve and fully verify each source. Package symlinks are resolved within a pinned package. */
export function resolveBrowserRuntimeAssets({
  manifestPath = defaultManifest,
  modelDirectory,
  packagesRoot = path.join(frontendRoot, "web/node_modules"),
  builtRoot,
  allowMissingModels = false,
} = {}) {
  const manifest = readBrowserRuntimeManifest(manifestPath);
  const packageEntries = manifest.files.filter(
    (entry) => entry.source.kind === "package",
  );
  if (builtRoot) {
    const names = [];
    const visit = (directory, prefix = "") => {
      for (const name of readdirSync(directory).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const file = path.join(directory, name);
        const info = lstatSync(file);
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
          throw new Error(`Unsafe built browser runtime member: ${relative}`);
        if (info.isDirectory()) visit(file, relative);
        else if (isOptionalBrowserCatalog(relative)) {
          if (info.nlink !== 1)
            throw new Error("Unsafe optional voice catalog");
        } else names.push(relative);
      }
    };
    visit(path.join(builtRoot, "onnx"));
    const inventoryOf = (entries) =>
      JSON.stringify(entries.map((entry) => entry.path).sort());
    const builtNames = JSON.stringify(names.sort());
    // A web build made without the optional model set carries packages only.
    const expected =
      allowMissingModels && builtNames === inventoryOf(packageEntries)
        ? packageEntries
        : manifest.files;
    if (builtNames !== inventoryOf(expected))
      throw new Error(
        "Built browser runtime inventory contains missing or unlisted files",
      );
    return expected.map((entry) => {
      const filePath = safeFile(path.join(builtRoot, "onnx"), entry.path);
      verifyFile(filePath, entry);
      return { ...entry, filePath };
    });
  }
  const modelManifestPath = path.resolve(
    path.dirname(manifestPath),
    "../browser-speech/manifest.json",
  );
  const modelManifest = JSON.parse(readFileSync(modelManifestPath, "utf8"));
  const modelEntries = manifest.files.filter(
    (entry) => entry.source.kind === "model-store",
  );
  if (
    modelManifest.files?.length !== MODEL_FILE_COUNT ||
    modelEntries.length !== MODEL_FILE_COUNT ||
    modelEntries.some(
      (entry) =>
        !modelManifest.files.some(
          (model) =>
            model.path === entry.source.path &&
            model.target === entry.path &&
            model.size === entry.size &&
            model.sha256 === entry.sha256,
        ),
    )
  )
    throw new Error("Browser model acquisition and runtime inventories differ");
  const models = modelDirectory ?? resolveModelDirectory();
  if (models !== null && !path.isAbsolute(models))
    throw new Error("Browser model directory must be absolute");
  const actualFiles = models === null ? [] : readdirSync(models).sort();
  // Unacquired sets resolve to null, or in Compose to the checked-in notices
  // directory that contains none of the model files. Partial sets still fail.
  const modelNames = new Set(modelEntries.map((entry) => entry.source.path));
  let entries = manifest.files;
  if (!actualFiles.some((name) => modelNames.has(name))) {
    if (!allowMissingModels)
      throw new Error(
        "Browser speech models are not acquired; run python3 scripts/models/browser_speech.py acquire",
      );
    entries = packageEntries;
  } else if (
    JSON.stringify(actualFiles) !==
    JSON.stringify(modelEntries.map((entry) => entry.source.path).sort())
  )
    throw new Error("Browser model store contains missing or unlisted files");
  const packageRoots = new Map();
  return entries.map((entry) => {
    let root = models;
    if (entry.source.kind === "package") {
      const name = entry.source.package;
      if (!packageRoots.has(name)) {
        const resolved = realpathSync(path.join(packagesRoot, name));
        const pkg = JSON.parse(
          readFileSync(path.join(resolved, "package.json"), "utf8"),
        );
        if (
          pkg.name !== entry.source.name ||
          pkg.version !== entry.source.version
        )
          throw new Error(`Wrong browser runtime dependency version: ${name}`);
        packageRoots.set(name, resolved);
      }
      root = packageRoots.get(name);
    }
    const filePath = safeFile(root, entry.source.path);
    verifyFile(filePath, entry, {
      rejectHardlinks: entry.source.kind === "model-store",
    });
    return { ...entry, filePath };
  });
}

/** Reject linked directory members, including Windows junctions; package roots were resolved explicitly. */
function safeFile(root, relative) {
  let current = path.resolve(root);
  for (const part of ["", ...relative.split("/")]) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error(`Linked browser runtime asset path: ${current}`);
  }
  return current;
}

/** Distribution artifacts need independent regular copies, never a developer cache symlink. */
export function copyBrowserRuntimeAssets(assets, outputDirectory) {
  for (const asset of assets) {
    verifyFile(asset.filePath, asset);
    const destination = path.join(outputDirectory, "onnx", asset.path);
    mkdirSync(outputDirectory, { recursive: true });
    let directory = outputDirectory;
    for (const part of ["", "onnx", ...asset.path.split("/").slice(0, -1)]) {
      directory = path.join(directory, part);
      if (!lstatSync(directory, { throwIfNoEntry: false }))
        mkdirSync(directory);
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Unsafe browser runtime build directory: ${directory}`);
    }
    // Vite may already have copied a legacy public input. Never follow a stale
    // output symlink/hardlink before replacing its bytes.
    const existing = lstatSync(destination, { throwIfNoEntry: false });
    if (
      existing &&
      (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)
    )
      throw new Error(`Unsafe browser runtime build output: ${destination}`);
    safeFile(outputDirectory, path.posix.dirname(`onnx/${asset.path}`));
    copyFileSync(asset.filePath, destination);
    verifyFile(safeFile(outputDirectory, `onnx/${asset.path}`), asset);
  }
}
