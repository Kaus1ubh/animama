import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { RuntimeError } from "../runtime/errors.js";
import {
  MAX_ENTRIES,
  PACK_METADATA,
  portablePath,
  type PackManifest,
} from "./catalog.js";

/** Require every ancestor to be a real directory, not a symlink into another tree. */
export async function realDirectory(directory: string): Promise<void> {
  const absolute = path.resolve(directory);
  if (
    (await realpath(absolute)) !== absolute ||
    !(await lstat(absolute)).isDirectory()
  )
    throw new RuntimeError("pack_path_invalid");
}
export async function hashFile(
  file: string,
  signal?: AbortSignal,
): Promise<string> {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
    throw new RuntimeError("pack_file_invalid");
  const hash = createHash("sha256");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      signal,
    }))
      hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/** Revalidate the complete inventory after extraction and at every startup. */
export async function verifyPackFiles(
  root: string,
  manifest: PackManifest,
  signal?: AbortSignal,
): Promise<void> {
  await realDirectory(root);
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const directories = new Set(
    manifest.files.flatMap((file) => {
      const parts = file.path.split("/");
      return parts
        .slice(0, -1)
        .map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  );
  const seen = new Set<string>();
  let count = 0;
  async function visit(relative: string): Promise<void> {
    for (const name of await readdir(path.join(root, relative))) {
      signal?.throwIfAborted();
      const key = relative ? `${relative}/${name}` : name;
      portablePath(key);
      if (++count > MAX_ENTRIES + 1)
        throw new RuntimeError("pack_inventory_invalid");
      const file = path.join(root, key);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new RuntimeError("pack_file_invalid");
      if (stat.isDirectory()) {
        if (!directories.has(key))
          throw new RuntimeError("pack_inventory_invalid");
        await visit(key);
      } else if (key === PACK_METADATA && stat.isFile() && stat.nlink === 1) {
        continue;
      } else {
        const entry = expected.get(key);
        if (
          !entry ||
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size !== entry.size_bytes ||
          // Windows has no POSIX modes; its size and hash are still checked.
          (process.platform !== "win32" &&
            (stat.mode & 0o7777) !== Number.parseInt(entry.mode, 8)) ||
          (await hashFile(file, signal)) !== entry.sha256
        )
          throw new RuntimeError("pack_file_invalid");
        seen.add(key);
      }
    }
  }
  await visit("");
  if (seen.size !== expected.size)
    throw new RuntimeError("pack_inventory_invalid");
}
