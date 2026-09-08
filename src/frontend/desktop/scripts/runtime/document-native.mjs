import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { filesIn, run, sha256 } from "./common.mjs";
import { isMachO } from "./macos-signing.mjs";

/** Read load commands, not otool -L's mixed list of dependencies and LC_ID_DYLIB. */
export function documentLoadCommands(output) {
  const dependencies = [];
  const rpaths = [];
  for (const block of output.split(/\nLoad command \d+\n/u)) {
    const command = block.match(/^\s*cmd (LC_\w+)$/mu)?.[1];
    if (command === "LC_RPATH") {
      const value = block.match(/^\s*path (.+) \(offset \d+\)$/mu)?.[1];
      if (!value) throw new Error("Malformed worker LC_RPATH");
      rpaths.push(value);
    } else if (
      /^LC_(?:LOAD|LOAD_WEAK|REEXPORT|LOAD_UPWARD|LAZY_LOAD)_DYLIB$/u.test(
        command ?? "",
      )
    ) {
      const value = block.match(/^\s*name (.+) \(offset \d+\)$/mu)?.[1];
      if (!value) throw new Error("Malformed worker library dependency");
      dependencies.push(value);
    }
  }
  return { dependencies, rpaths };
}

/**
 * Keep the pack regular-file-only without duplicating Torch's large dylibs.
 * Only proven PyInstaller aliases into torch/lib are removed; other packages'
 * ctypes lookups may need their top-level aliases. All affected Mach-O loads
 * become explicit loader-relative references before signing, then are audited
 * again with the aliases absent. The source frozen tree is never modified.
 */
export function prepareDocumentLibraries({
  frozenRoot,
  executableRoot,
  runNative = run,
}) {
  const inside = (file) =>
    file === executableRoot || file.startsWith(`${executableRoot}${path.sep}`);
  const expand = (value, file) => {
    if (!/^@(loader|executable)_path(?:\/|$)/u.test(value))
      throw new Error(`Worker library path is not relocatable: ${value}`);
    return path.resolve(
      value
        .replace(/^@loader_path/u, path.dirname(file))
        .replace(/^@executable_path/u, executableRoot),
    );
  };
  const inspect = (file) =>
    documentLoadCommands(
      runNative("/usr/bin/otool", ["-l", file], { capture: true }),
    );
  const main = path.join(executableRoot, "animama-document-worker");
  const mainRpaths = inspect(main).rpaths.map((value) => expand(value, main));
  const resolveDependency = (dependency, file, rpaths) => {
    if (
      dependency.startsWith("/usr/lib/") ||
      dependency.startsWith("/System/Library/")
    )
      return null;
    if (path.isAbsolute(dependency))
      throw new Error(
        `Worker embeds an absolute non-system library: ${dependency}`,
      );
    const candidates = dependency.startsWith("@rpath/")
      ? rpaths.map((directory) => path.resolve(directory, dependency.slice(7)))
      : [expand(dependency, file)];
    const resolved = candidates.find(
      (candidate) => inside(candidate) && existsSync(candidate),
    );
    if (!resolved)
      throw new Error(
        `Worker has an unresolved non-system library: ${path.relative(executableRoot, file)} -> ${dependency}`,
      );
    return resolved;
  };
  const aliases = new Map();
  const retainedAliases = new Map();
  const torchNames = new Set([
    "libc10.dylib",
    "libomp.dylib",
    "libshm.dylib",
    "libtorch.dylib",
    "libtorch_cpu.dylib",
    "libtorch_python.dylib",
  ]);
  for (const name of readdirSync(path.join(frozenRoot, "_internal"))) {
    const source = path.join(frozenRoot, "_internal", name);
    if (!lstatSync(source).isSymbolicLink() || !name.endsWith(".dylib"))
      continue;
    const relative = path.relative(
      realpathSync(frozenRoot),
      realpathSync(source),
    );
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`Worker alias escapes its source: ${name}`);
    if (torchNames.has(name) && relative !== `_internal/torch/lib/${name}`)
      throw new Error(`Unexpected worker Torch alias: ${name}`);
    const alias = path.join(executableRoot, "_internal", name);
    const target = path.join(executableRoot, relative);
    if (!isMachO(target) || sha256(alias) !== sha256(target))
      throw new Error(`Worker alias does not match its library: ${name}`);
    (torchNames.has(name) ? aliases : retainedAliases).set(alias, target);
  }
  // filesIn rejects every surviving symlink, including ones unrelated to Torch.
  const nativeFiles = filesIn(executableRoot)
    .map((name) => path.join(executableRoot, name))
    .filter(isMachO)
    .filter((file) => !aliases.has(file));
  const relocationInventory = [];
  const relocate = (file, command, from, to) => {
    if (from === to) return;
    runNative("/usr/bin/install_name_tool", [command, from, to, file], {
      capture: true,
    });
    relocationInventory.push({
      path: path.relative(executableRoot, file),
      command,
      from,
      to,
    });
  };
  const loaderRelative = (file, target) =>
    `@loader_path/${path.relative(path.dirname(file), target) || "."}`;
  const audit = (file) => {
    const commands = inspect(file);
    const rpaths = [
      ...commands.rpaths.map((value) => expand(value, file)),
      ...mainRpaths,
    ];
    if (rpaths.some((entry) => !inside(entry)))
      throw new Error(`Worker has an external library search path: ${file}`);
    return { ...commands, rpaths };
  };
  // A materialized alias has moved relative to its siblings. Preserve the
  // canonical library's search locations instead of searching outside the app.
  for (const [alias, target] of retainedAliases) {
    const commands = inspect(target);
    for (const value of commands.rpaths) {
      const resolved = expand(value, target);
      if (!inside(resolved))
        throw new Error(`Worker alias has an external search path: ${alias}`);
      relocate(alias, "-rpath", value, loaderRelative(alias, resolved));
    }
    for (const dependency of commands.dependencies) {
      if (/^@(loader|executable)_path(?:\/|$)/u.test(dependency)) {
        const resolved = expand(dependency, target);
        if (!inside(resolved))
          throw new Error(`Worker alias has an external dependency: ${alias}`);
        relocate(alias, "-change", dependency, loaderRelative(alias, resolved));
      }
    }
  }
  for (const file of nativeFiles) {
    const { dependencies, rpaths } = audit(file);
    for (const dependency of dependencies) {
      const target = aliases.get(resolveDependency(dependency, file, rpaths));
      if (!target) continue;
      relocate(file, "-change", dependency, loaderRelative(file, target));
    }
  }
  for (const alias of aliases.keys()) rmSync(alias);
  const files = nativeFiles.map((file) => {
    runNative("/usr/bin/lipo", [file, "-verify_arch", "arm64"], {
      capture: true,
    });
    const { dependencies, rpaths } = audit(file);
    for (const dependency of dependencies)
      resolveDependency(dependency, file, rpaths);
    return { path: path.relative(executableRoot, file), dependencies };
  });
  return { files, relocations: relocationInventory };
}
