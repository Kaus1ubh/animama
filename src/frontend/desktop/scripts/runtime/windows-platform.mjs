import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import path from "node:path";
import { run } from "./common.mjs";

/** Identify PE images by their headers; .pyd and .node files are DLLs too. */
export function isPortableExecutable(file) {
  const header = Buffer.alloc(64);
  const descriptor = openSync(file, "r");
  try {
    if (readSync(descriptor, header, 0, 64, 0) < 64) return false;
    if (header.toString("latin1", 0, 2) !== "MZ") return false;
    const signature = Buffer.alloc(4);
    const offset = header.readUInt32LE(0x3c);
    return (
      readSync(descriptor, signature, 0, 4, offset) === 4 &&
      signature.equals(Buffer.from("PE\0\0", "latin1"))
    );
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Read imported and delay-loaded DLL names from English `dumpbin /dependents`
 * output. Unrecognized output fails, so a format change cannot hide imports.
 */
export function parseDumpbinDependents(output) {
  if (!/^\s*Dump of file /mu.test(output) || !/^\s*Summary\s*$/mu.test(output))
    throw new Error("Unrecognized dumpbin output");
  const names = [];
  let collecting = false;
  for (const line of output.split(/\r?\n/u)) {
    const text = line.trim();
    if (/^Image has the following (?:delay load )?dependencies:$/u.test(text))
      collecting = true;
    else if (collecting && /^Summary$/u.test(text)) collecting = false;
    else if (collecting && text) {
      if (!/^[\w.+-]+\.(?:dll|exe|sys|drv|cpl)$/iu.test(text))
        throw new Error(`Unexpected dumpbin dependency line: ${text}`);
      names.push(text.toLowerCase());
    }
  }
  return [...new Set(names)].sort();
}

/** Imported and delay-loaded DLL names of one PE file, using the MSVC dumpbin. */
export function dumpbinDependents(file, { runNative = run, env } = {}) {
  return parseDumpbinDependents(
    runNative("dumpbin", ["/nologo", "/dependents", file], {
      capture: true,
      env,
    }),
  );
}

/**
 * Microsoft's VC++ runtime DLLs, including delvewheel's hash-suffixed copies.
 * They must ship app-local, never resolve from System32.
 */
export const VC_RUNTIME_DLL =
  /^(?:vcruntime140(?:_1)?|msvcp140(?:_\w+)?|concrt140)(?:-[0-9a-f]{32})?\.dll$/iu;

const API_SET = /^(?:api|ext)-ms-win-[\w.-]+\.dll$/u;

/**
 * Decide where the Windows loader finds one import. A name already present in
 * the importer's directory or the process's application directories wins over
 * System32, so the stage is checked first. Only reviewed OS names may resolve
 * outside the stage, and only when Windows actually ships them.
 */
export function resolveDependency(
  name,
  importer,
  {
    stagedNames,
    searchDirs,
    systemDlls,
    systemDirectory,
    hostImports = new Set(),
    exists = existsSync,
  },
) {
  if (API_SET.test(name)) return "api-set";
  // node-gyp's delay-load hook binds an addon's node.exe imports to the host
  // process, which is the staged Electron executable.
  if (importer.endsWith(".node") && hostImports.has(name)) return "host";
  for (const directory of [path.posix.dirname(importer), ...searchDirs]) {
    const candidate = path.posix.join(directory, name);
    const staged = stagedNames.get(candidate.toLowerCase());
    if (staged) return `stage:${staged}`;
  }
  if (systemDlls.has(name) && exists(path.join(systemDirectory, name)))
    return "system";
  throw new Error(
    `${importer}: ${name} does not resolve inside the stage or to a reviewed Windows DLL`,
  );
}

/**
 * Record every PE import under `root` and reject any DLL that would load from
 * outside the stage or the reviewed system set. `searchDirs(importer)` returns
 * the root-relative folders the importer's process adds to the loader search.
 */
export function auditWindowsDependencies(
  root,
  names,
  {
    searchDirs = () => [],
    systemDlls,
    systemDirectory = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
    ),
    hostImports = [],
    runNative = run,
    env,
  },
) {
  const stagedNames = new Map(names.map((name) => [name.toLowerCase(), name]));
  const allowed = new Set(systemDlls.map((name) => name.toLowerCase()));
  const host = new Set(hostImports);
  const files = [];
  for (const name of names) {
    const file = path.join(root, name);
    if (!isPortableExecutable(file)) continue;
    files.push({
      path: name,
      dependencies: dumpbinDependents(file, { runNative, env }).map(
        (dependency) => ({
          name: dependency,
          resolved: resolveDependency(dependency, name, {
            stagedNames,
            searchDirs: searchDirs(name),
            systemDlls: allowed,
            systemDirectory,
            hostImports: host,
          }),
        }),
      ),
    });
  }
  return files;
}

/** Fail when a shipped binary embeds a build-machine path (ASCII or UTF-16). */
export function assertNoEmbeddedPaths(root, names, needles) {
  const patterns = needles.flatMap((needle) =>
    [needle, needle.replaceAll("\\", "/")].flatMap((text) => [
      Buffer.from(text.toLowerCase(), "latin1"),
      Buffer.from(text.toLowerCase(), "utf16le"),
    ]),
  );
  for (const name of names) {
    const bytes = Buffer.from(
      readFileSync(path.join(root, name)).toString("latin1").toLowerCase(),
      "latin1",
    );
    if (patterns.some((pattern) => bytes.includes(pattern)))
      throw new Error(`${name} embeds a build-machine path`);
  }
}

/**
 * Wheels repaired by delvewheel keep their DLLs in `<package>.libs` folders,
 * which the package adds to the DLL search with os.add_dll_directory.
 */
function wheelLibraryDirs(names) {
  return [
    ...new Set(
      names
        .map((name) => name.match(/^(backend\/_internal\/[^/]+\.libs)\//u)?.[1])
        .filter(Boolean),
    ),
  ];
}

/**
 * Folders a staged process adds to the DLL search beyond an importer's own
 * folder. Processes never share them: PostgreSQL extensions load into
 * postgres.exe, while the backend's PyInstaller bootloader adds its executable
 * and `_internal` folders, PyInstaller's pywin32 hook adds `pywin32_system32`,
 * and delvewheel packages add their `*.libs` folders.
 */
export function stageSearchDirs(part, names) {
  if (part !== "runtime") return () => [];
  const backend = [
    "backend",
    "backend/_internal",
    "backend/_internal/pywin32_system32",
    ...wheelLibraryDirs(names),
  ];
  return (importer) =>
    importer.startsWith("postgres/")
      ? ["postgres/bin"]
      : importer.startsWith("backend/")
        ? backend
        : [];
}

/** Audit every PE file of a Windows stage, component by component. */
export function auditWindowsStage(
  roots,
  files,
  { systemDlls, env, runNative = run, systemDirectory },
) {
  return Object.fromEntries(
    Object.entries(files).map(([part, names]) => [
      part,
      auditWindowsDependencies(roots[part], names, {
        searchDirs: stageSearchDirs(part, names),
        systemDlls,
        systemDirectory,
        hostImports: part === "app" ? ["node.exe"] : [],
        runNative,
        env,
      }),
    ]),
  );
}
