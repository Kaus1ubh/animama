import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { filesIn, sha256 } from "./common.mjs";

function componentFor(relative) {
  if (
    relative.startsWith("web/onnx/") ||
    relative.startsWith("web/tts/") ||
    relative.endsWith(".wasm")
  )
    return "browser_runtimes";
  if (relative.startsWith("web/")) return "web_javascript";
  if (relative.startsWith("content/")) return "starter_content";
  if (relative.startsWith("backend/")) return "frozen_backend";
  if (relative.startsWith("postgres/")) return "postgresql";
  if (relative.startsWith("licenses/")) return "licenses";
  return "package_overhead";
}

export function assertPortablePath(relative) {
  if (
    typeof relative !== "string" ||
    relative !== relative.normalize("NFC") ||
    /[\\:\x00-\x1f]/u.test(relative) ||
    relative.split("/").some((part) => ["", ".", ".."].includes(part))
  ) {
    throw new Error(`Unsafe manifest path: ${relative}`);
  }
}

// Windows has no POSIX mode bits; its executable code is the PE files.
const WINDOWS_EXECUTABLE = /\.(?:exe|dll|pyd|node)$/iu;

/** Native builds only target their host, so the host decides the mode model. */
function isExecutable(relative, stat) {
  return process.platform === "win32"
    ? WINDOWS_EXECUTABLE.test(relative)
    : Boolean(stat.mode & 0o111);
}

export function inventoryTree(root) {
  return filesIn(root)
    .filter((name) => name !== "manifest.json")
    .map((relative) => {
      assertPortablePath(relative);
      const file = path.join(root, relative);
      const stat = lstatSync(file);
      const executable = isExecutable(relative, stat);
      return {
        path: relative,
        size_bytes: stat.size,
        sha256: sha256(file),
        mode: executable ? "0755" : "0644",
        component: componentFor(relative),
        critical:
          executable ||
          /\.(?:sql|json|py|pyc|dylib|so|dll|exe|node)$/u.test(relative),
      };
    });
}

export function inventoryId(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

/** Electron keeps signed framework links; all links must remain in its tree. */
export function componentInventory(root) {
  const result = [];
  const visit = (relative) => {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      assertPortablePath(key);
      const absolute = path.join(root, key);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(absolute);
        const resolved = path.relative(
          realpathSync(root),
          realpathSync(absolute),
        );
        if (
          path.isAbsolute(link) ||
          resolved.startsWith("..") ||
          path.isAbsolute(resolved)
        )
          throw new Error("Component link escaped its tree");
        result.push({
          path: key,
          type: "symlink",
          target: link,
          size_bytes: Buffer.byteLength(link),
        });
      } else if (stat.isDirectory()) visit(key);
      else if (stat.isFile())
        result.push({
          path: key,
          type: "file",
          size_bytes: stat.size,
          sha256: sha256(absolute),
          mode: stat.mode & 0o777,
        });
      else throw new Error("Special component file");
    }
  };
  visit("");
  return result.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/** No additions, removals, case collisions, stale bytes, or executable-bit drift. */
export function assertInventory(root, expected) {
  const keys = new Set();
  let previous = "";
  for (const file of expected) {
    assertPortablePath(file.path);
    const key = file.path.toLowerCase();
    if (keys.has(key) || (previous && file.path <= previous))
      throw new Error("Manifest files must be unique and sorted");
    keys.add(key);
    previous = file.path;
  }
  const actual = inventoryTree(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Runtime inventory mismatch: missing, unexpected, modified, or misclassified files",
    );
  for (const file of actual) {
    if (/better[-_]auth|(?:^|\/)\.env(?:\.|$)|\.DS_Store$/iu.test(file.path))
      throw new Error("Forbidden local runtime payload");
    if (process.platform === "win32") continue;
    const mode = lstatSync(path.join(root, file.path)).mode & 0o777;
    if (mode !== Number.parseInt(file.mode, 8))
      throw new Error(`Non-normalized file mode: ${file.path}`);
  }
  return actual;
}
