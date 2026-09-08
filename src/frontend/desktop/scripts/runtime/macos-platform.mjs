import { closeSync, openSync } from "node:fs";
import path from "node:path";
import { run } from "./common.mjs";
import { isMachO } from "./macos-signing.mjs";

/** Normalize deployment versions, not SDK versions or the build host's OS. */
function versionParts(value) {
  if (!/^\d+\.\d+(?:\.\d+)?$/u.test(value))
    throw new Error(`Invalid macOS deployment version: ${value}`);
  return value.split(".").map(Number).concat([0]).slice(0, 3);
}

/** Reject a native binary that cannot load on the advertised minimum OS. */
export function assertMacosMinimum(output, minimum) {
  const limit = versionParts(minimum);
  const versions = [];
  for (const block of output.split(/\nLoad command \d+\n/u)) {
    const command = block.match(/^\s*cmd (LC_\w+)$/mu)?.[1];
    let value;
    if (command === "LC_BUILD_VERSION") {
      if (!/^\s*platform (?:1|macos)\s*$/mu.test(block))
        throw new Error("Native binary does not target macOS");
      value = block.match(/^\s*minos (\S+)\s*$/mu)?.[1];
    } else if (command === "LC_VERSION_MIN_MACOSX") {
      value = block.match(/^\s*version (\S+)\s*$/mu)?.[1];
    } else continue;
    if (!value)
      throw new Error("Native binary has no macOS deployment version");
    const parts = versionParts(value);
    const difference = parts
      .map((part, i) => part - limit[i])
      .find((part) => part !== 0);
    if (difference > 0)
      throw new Error(
        `Native binary requires macOS ${value}, above advertised minimum ${minimum}`,
      );
    versions.push(value);
  }
  if (!versions.length)
    throw new Error("Native binary has no macOS deployment version");
  return [...new Set(versions)];
}

/** Inspect only the shipped arm64 slice; never run the native code. */
export function auditMacosMinimum(root, names, minimum, runNative = run) {
  const files = [];
  for (const name of names) {
    const file = path.join(root, name);
    if (!isMachO(file)) continue;
    try {
      // Apple's classic otool parses `(name)` as an archive member even when it
      // is a literal argv path. Electron's signed helpers legitimately contain
      // `(GPU)` and `(Renderer)`, so inspect an already-open descriptor instead.
      const descriptor = openSync(file, "r");
      let output;
      try {
        output = runNative(
          "/usr/bin/otool",
          ["-arch", "arm64", "-l", "/dev/fd/3"],
          { capture: true, extraStdio: [descriptor] },
        );
      } finally {
        closeSync(descriptor);
      }
      const versions = assertMacosMinimum(output, minimum);
      files.push({ path: name, minimum_macos: versions });
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    }
  }
  return files;
}
