import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as zstdConstants, createZstdDecompress } from "node:zlib";
import { extract } from "tar-stream";
import { atomicWrite, syncDirectory } from "../runtime/atomic-file.js";
import { RuntimeError } from "../runtime/errors.js";
import {
  MAX_ENTRIES,
  PACK_METADATA,
  pathKey,
  portablePath,
  type PackManifest,
} from "./catalog.js";
import { verifyPackFiles } from "./files.js";

/** Reject extension/sparse/special headers before tar-stream can buffer them.
 * Our producer emits USTAR only: no PAX/GNU long-header allocation is needed.
 */
class TarEnvelope extends Transform {
  private pending = Buffer.alloc(0);
  private remaining = 0;
  private zeros = 0;
  private count = 0;
  private total = 0;
  constructor(private maximum: number) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      this.total += chunk.length;
      if (this.total > this.maximum)
        throw new RuntimeError("pack_expansion_limit");
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length >= 512) {
        const block = this.pending.subarray(0, 512);
        this.pending = this.pending.subarray(512);
        if (this.remaining) {
          this.remaining -= 512;
          continue;
        }
        if (block.every((value) => value === 0)) {
          this.zeros++;
          continue;
        }
        if (
          this.zeros ||
          ++this.count > MAX_ENTRIES ||
          ![0, 48, 53].includes(block[156]!) ||
          block.toString("ascii", 257, 262) !== "ustar"
        )
          throw new RuntimeError("pack_entry_type_invalid");
        const sizeText = block
          .toString("ascii", 124, 136)
          .replace(/\0.*$/u, "")
          .trim();
        if (!/^[0-7]{1,11}$/u.test(sizeText))
          throw new RuntimeError("pack_entry_size_invalid");
        const size = Number.parseInt(sizeText, 8);
        if (size > this.maximum || (block[156] === 53 && size !== 0))
          throw new RuntimeError("pack_entry_size_invalid");
        this.remaining = Math.ceil(size / 512) * 512;
      }
      callback(null, chunk);
    } catch (error) {
      callback(error as Error);
    }
  }
  override _flush(callback: TransformCallback): void {
    callback(
      this.pending.length || this.remaining || this.zeros < 2
        ? new RuntimeError("pack_archive_truncated")
        : undefined,
    );
  }
}

/** Extract only declared regular files into a new private staging tree. */
export async function extractPack(
  archive: string,
  destination: string,
  manifest: PackManifest,
  signal: AbortSignal,
): Promise<void> {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const directories = new Set<string>();
  for (const name of files.keys()) {
    const parts = name.split("/");
    for (let count = 1; count < parts.length; count++)
      directories.add(parts.slice(0, count).join("/"));
  }
  await mkdir(destination, { mode: 0o700 });
  // Implicit directories are derived from the trusted inventory, not archive headers.
  for (const directory of [...directories].sort())
    await mkdir(path.join(destination, directory), {
      recursive: true,
      mode: 0o700,
    });
  const seen = new Set<string>();
  const written = new Set<string>();
  const parser = extract();
  parser.on("entry", (header, stream, next) => {
    void (async () => {
      signal.throwIfAborted();
      const name =
        header.type === "directory" && header.name.endsWith("/")
          ? header.name.slice(0, -1)
          : header.name;
      portablePath(name);
      const key = pathKey(name);
      if (seen.has(key)) throw new RuntimeError("pack_path_collision");
      seen.add(key);
      if (header.type === "directory") {
        if (header.size !== 0 || !directories.has(name))
          throw new RuntimeError("pack_entry_undeclared");
        stream.resume();
        return;
      }
      const file = files.get(name);
      if (
        header.type !== "file" ||
        !file ||
        header.linkname ||
        header.pax ||
        header.size !== file.size_bytes ||
        ((header.mode ?? 0) & 0o7777) !== Number.parseInt(file.mode, 8)
      )
        throw new RuntimeError("pack_entry_invalid");
      const handle = await open(
        path.join(destination, name),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of stream) {
          signal.throwIfAborted();
          if (!Buffer.isBuffer(chunk))
            throw new RuntimeError("pack_entry_invalid");
          size += chunk.length;
          if (size > file.size_bytes)
            throw new RuntimeError("pack_expansion_limit");
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (size !== file.size_bytes || hash.digest("hex") !== file.sha256)
          throw new RuntimeError("pack_file_invalid");
        await handle.chmod(Number.parseInt(file.mode, 8));
        await handle.sync();
        written.add(name);
      } finally {
        await handle.close();
      }
    })().then(
      () => next(),
      (error) => next(error as Error),
    );
  });
  const input = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await pipeline(
      input.createReadStream({ autoClose: false }),
      createZstdDecompress({
        params: { [zstdConstants.ZSTD_d_windowLogMax]: 27 },
      }),
      new TarEnvelope(
        manifest.installed_bytes +
          (files.size + directories.size) * 1024 +
          10240,
      ),
      parser,
      { signal },
    );
  } finally {
    await input.close();
  }
  if (written.size !== files.size)
    throw new RuntimeError("pack_inventory_invalid");
  atomicWrite(path.join(destination, PACK_METADATA), JSON.stringify(manifest));
  await verifyPackFiles(destination, manifest, signal);
  for (const directory of [...directories].sort().reverse())
    syncDirectory(path.join(destination, directory));
  syncDirectory(destination);
}
