import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, privateDirectory } from "../runtime/atomic-file.js";
import { RuntimeError } from "../runtime/errors.js";
import {
  PACK_METADATA,
  packContentDigest,
  validateModelObjectUrl,
  type ModelPackManifest,
  type ModelPackFile,
} from "./catalog.js";
import { downloadObject } from "./download.js";
import {
  hashFile,
  realDirectory,
  syncDirectory,
  verifyPackFiles,
} from "./files.js";

/** Retained bytes are scoped to the complete inventory, never an app version or mutable URL. */
export function modelDownloadDirectory(
  downloads: string,
  manifest: ModelPackManifest,
): string {
  return path.join(
    downloads,
    `${manifest.id}.${packContentDigest(manifest)}.objects`,
  );
}

async function regularSize(file: string): Promise<number | undefined> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new RuntimeError("pack_path_invalid");
    return stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Validate the retained cache and credit only bounded payload bytes already occupying disk. */
export async function prepareModelDownloads(
  directory: string,
  manifest: ModelPackManifest,
  signal: AbortSignal,
): Promise<number> {
  privateDirectory(directory);
  const allowed = new Set(
    manifest.files.flatMap((_, index) => [
      `${index}.complete`,
      `${index}.partial`,
      `${index}.partial.json`,
    ]),
  );
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name);
    await regularSize(file);
    // A crash during atomic resume-metadata writing can leave an untrusted temporary.
    const temporary = /^\.(\d+)\.partial\.json\.[a-f0-9-]{36}\.tmp$/.exec(name);
    if (temporary && Number(temporary[1]) < manifest.files.length) {
      await rm(file);
      continue;
    }
    if (!allowed.has(name)) throw new RuntimeError("pack_inventory_invalid");
  }
  let retained = 0;
  for (const [index, file] of manifest.files.entries()) {
    signal.throwIfAborted();
    let fileRetained = 0;
    const complete = path.join(directory, `${index}.complete`);
    const size = await regularSize(complete);
    if (size !== undefined) {
      if (
        size === file.size_bytes &&
        (await hashFile(complete, signal)) === file.sha256
      )
        fileRetained += size;
      else await rm(complete);
    }
    const partial = path.join(directory, `${index}.partial`);
    const partialSize = await regularSize(partial);
    if (partialSize !== undefined) {
      if (partialSize <= file.size_bytes) fileRetained += partialSize;
      else {
        await rm(partial);
        await rm(`${partial}.json`, { force: true });
      }
    }
    retained += Math.min(fileRetained, file.size_bytes);
  }
  // Duplicate complete/partial files must never yield more credit than one whole payload.
  return Math.min(retained, manifest.installed_bytes);
}

/** Copy through no-follow descriptors; retained cache data never becomes a hardlinked installed file. */
async function copyModelFile(
  source: string,
  target: string,
  file: ModelPackFile,
  signal: AbortSignal,
): Promise<void> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.size_bytes)
      throw new RuntimeError("pack_file_invalid");
    const output = await open(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      let size = 0;
      for await (const chunk of input.createReadStream({
        autoClose: false,
        signal,
      })) {
        signal.throwIfAborted();
        size += chunk.length;
        if (size > file.size_bytes) throw new RuntimeError("pack_file_invalid");
        await output.writeFile(chunk);
      }
      if (size !== file.size_bytes) throw new RuntimeError("pack_file_invalid");
      await output.chmod(Number.parseInt(file.mode, 8));
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

/** Fetch sequential immutable objects, retain verified progress, and assemble a new complete staging tree. */
export async function stageModelFiles(options: {
  directory: string;
  staging: string;
  manifest: ModelPackManifest;
  signal: AbortSignal;
  progress(bytes: number): void;
}): Promise<void> {
  const { directory, staging, manifest, signal, progress } = options;
  await realDirectory(directory);
  await mkdir(staging, { mode: 0o700 });
  let transferred = 0;
  for (const [index, file] of manifest.files.entries()) {
    signal.throwIfAborted();
    const complete = path.join(directory, `${index}.complete`);
    const partial = path.join(directory, `${index}.partial`);
    if ((await regularSize(complete)) === undefined) {
      // A crash after transfer but before promotion can leave complete verified partial bytes.
      if (
        (await regularSize(partial)) !== file.size_bytes ||
        (await hashFile(partial, signal)) !== file.sha256
      )
        await downloadObject({
          object: file,
          partial,
          signal,
          progress: (bytes) => progress(transferred + bytes),
          urlPolicy: (value, redirect) => {
            if (redirect) throw new RuntimeError("pack_download_redirect");
            return validateModelObjectUrl(value, manifest.model_id, file);
          },
        });
      await rename(partial, complete);
      await rm(`${partial}.json`, { force: true });
      await syncDirectory(directory);
    }
    transferred += file.size_bytes;
    progress(transferred);
    await copyModelFile(complete, path.join(staging, file.path), file, signal);
  }
  atomicWrite(path.join(staging, PACK_METADATA), JSON.stringify(manifest));
  await verifyPackFiles(staging, manifest, signal);
  await syncDirectory(staging);
}

/** Explicit removal clears only this pack's retained model-download inventories. */
export async function removeModelDownloads(
  downloads: string,
  id: string,
): Promise<void> {
  await realDirectory(downloads);
  for (const name of await readdir(downloads)) {
    if (
      !name.startsWith(`${id}.`) ||
      !/^[a-z-]+\.[a-f0-9]{64}\.objects$/.test(name)
    )
      continue;
    const directory = path.join(downloads, name);
    await realDirectory(directory);
    await rm(directory, { recursive: true });
  }
  await syncDirectory(downloads);
}
