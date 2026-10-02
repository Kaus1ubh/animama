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
  { stagedNames, searchDirs, systemDlls, systemDirectory, exists = existsSync },
) {
  if (API_SET.test(name)) return "api-set";
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
 * outside the stage or the reviewed system set. `searchDirs` are stage-relative
 * directories the process adds to the loader search (its application directory).
 */
export function auditWindowsDependencies(
  root,
  names,
  {
    searchDirs = [],
    systemDlls,
    systemDirectory = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
    ),
    runNative = run,
    env,
  },
) {
  const stagedNames = new Map(names.map((name) => [name.toLowerCase(), name]));
  const allowed = new Set(systemDlls.map((name) => name.toLowerCase()));
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
            searchDirs,
            systemDlls: allowed,
            systemDirectory,
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
