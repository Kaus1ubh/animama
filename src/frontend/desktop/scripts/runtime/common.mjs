import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
export const frontendRoot = path.dirname(desktopRoot);
export const repoRoot = path.resolve(frontendRoot, "../..");
export const sourceRoot = path.join(desktopRoot, "runtime");
export const cacheRoot = path.join(desktopRoot, ".desktop-runtime");
// ZIP cannot represent the Unix epoch. Use one fixed, portable date everywhere.
const normalizedTime = new Date("2000-01-01T00:00:00Z");

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** No user-controlled path or unknown target can reach downloads or deletion. */
export function parseTarget(argv = process.argv.slice(2)) {
  const args = argv.filter((arg) => arg !== "--");
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--platform", "--arch"].includes(args[i]) ||
      !args[i + 1] ||
      values[args[i]]
    ) {
      throw new Error("Expected --platform <darwin|win32> --arch <arm64|x64>");
    }
    values[args[i]] = args[i + 1];
  }
  const platform = values["--platform"];
  const arch = values["--arch"];
  if (
    !(
      (platform === "darwin" && arch === "arm64") ||
      (platform === "win32" && arch === "x64")
    )
  ) {
    throw new Error("Supported targets are darwin-arm64 and win32-x64");
  }
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(
      "Runtime builds and audits must run on the native target; cross-building is unsupported",
    );
  }
  if (platform !== "darwin")
    throw new Error("Windows runtime staging is gated on desktop Phase 5");
  const target = `${platform}-${arch}`;
  const output = path.join(cacheRoot, target);
  return {
    platform,
    arch,
    target,
    output,
    runtime: path.join(output, "runtime"),
  };
}

/** Release archives can be gigabytes; hash a fixed-size buffer rather than loading the archive. */
export function sha256(file) {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const length = readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** Sorted, regular files only. Symlinks are materialized by component builders. */
export function filesIn(root, relative = "") {
  const result = [];
  for (const entry of readdirSync(path.join(root, relative)).sort()) {
    const name = relative ? `${relative}/${entry}` : entry;
    const stat = lstatSync(path.join(root, name));
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Non-regular staged member: ${name}`);
    }
    if (stat.isDirectory()) result.push(...filesIn(root, name));
    else result.push(name);
  }
  return result.sort();
}

export function normalizeTree(root) {
  for (const relative of filesIn(root)) {
    const file = path.join(root, relative);
    chmodSync(file, lstatSync(file).mode & 0o111 ? 0o755 : 0o644);
    utimesSync(file, normalizedTime, normalizedTime);
  }
}

/** Remove Finder metadata from generated web output, never from source assets. */
export function removeFinderMetadata(root) {
  for (const name of readdirSync(root).sort()) {
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) {
      removeFinderMetadata(file);
      if (readdirSync(file).length === 0) rmdirSync(file);
    } else if (!stat.isFile()) {
      throw new Error("Non-regular web build member");
    } else if (name === ".DS_Store") {
      rmSync(file);
    }
  }
}

/** Materialize only in-tree links, except Electron's signed framework layout. */
export function copyTree(source, destination, { preserveLinks = false } = {}) {
  const root = realpathSync(source);
  const copy = (from, to) => {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(from);
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Component symlink escapes its root");
      if (preserveLinks) {
        const link = readlinkSync(from);
        if (path.isAbsolute(link))
          throw new Error("Absolute framework symlink is not portable");
        symlinkSync(link, to);
      } else copy(target, to);
    } else if (stat.isDirectory()) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from).sort())
        copy(path.join(from, name), path.join(to, name));
    } else if (stat.isFile()) {
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      chmodSync(to, stat.mode & 0o111 ? 0o755 : 0o644);
    } else throw new Error("Special file in runtime component");
  };
  copy(root, destination);
}

/** Use argv arrays, never a shell; callers must keep secrets in the environment. */
export function run(
  command,
  args,
  { cwd = repoRoot, env = {}, capture = false, logFile, extraStdio = [] } = {},
) {
  const standard = capture || logFile ? "pipe" : "inherit";
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    // An entry at index zero is exposed to the child as descriptor 3. This lets
    // native inspectors read an already-open file without reparsing its name.
    stdio: extraStdio.length
      ? [standard, standard, standard, ...extraStdio]
      : standard,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (logFile)
    writeFileSync(logFile, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write((result.stderr ?? "").slice(-6000));
    throw new Error(
      `${path.basename(command)} failed (status ${result.status})`,
    );
  }
  return result.stdout ?? "";
}

// The frozen runtime embeds the interpreter's sysconfig paths. uv's default
// install directory is inside the builder's home, so pin a neutral one.
const PYTHON_INSTALL_DIR = "/Users/Shared/animama-build/uv-python";

/**
 * /Users/Shared is writable by every account. uv would run, and the build would
 * freeze, an interpreter another account planted there, so require private
 * ownership before any command installs or uses it.
 */
export function assertPrivatePythonInstallDir() {
  for (const directory of [
    path.dirname(PYTHON_INSTALL_DIR),
    PYTHON_INSTALL_DIR,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o022
    )
      throw new Error(
        `${directory} must be a directory owned by this user and not writable by others`,
      );
  }
}

export function pythonEnvironment() {
  return {
    UV_CACHE_DIR: process.env.UV_CACHE_DIR || "/private/tmp/animama-uv-cache",
    UV_PYTHON_INSTALL_DIR: PYTHON_INSTALL_DIR,
    UV_PROJECT_ENVIRONMENT: path.join(cacheRoot, "build-venv", "darwin-arm64"),
    PYTHONHASHSEED: "0",
    SOURCE_DATE_EPOCH: String(normalizedTime.getTime() / 1000),
    MACOSX_DEPLOYMENT_TARGET: "15.0",
    PYINSTALLER_CONFIG_DIR: path.join(cacheRoot, "pyinstaller-cache"),
    ANIMAMA_LOG_TO_FILE: "0",
    ANIMAMA_LOG_TO_CONSOLE: "0",
  };
}

export function buildPython() {
  return path.join(pythonEnvironment().UV_PROJECT_ENVIRONMENT, "bin", "python");
}
