import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";

export const PARAKEET_MOUNT = "/onnx/models/parakeet-tdt-0.6b-v2/";
export type ModelPackMount = {
  root: string;
  version: string;
  files: ReadonlyArray<{
    path: string;
    size_bytes: number;
    sha256: string;
    media_type: string;
  }>;
};

/** Only inventory-listed model/configuration bytes; never a general filesystem mount. */
export function createModelPackHandler(mount: ModelPackMount) {
  const root = path.resolve(mount.root);
  const files = new Map(mount.files.map((file) => [file.path, file]));
  return async (context: Context): Promise<Response> => {
    const url = new URL(context.req.url);
    let name: string;
    try {
      name = decodeURIComponent(url.pathname.slice(PARAKEET_MOUNT.length));
    } catch {
      return context.newResponse(null, 400);
    }
    if (
      /[\\:\x00-\x1f]/u.test(name) ||
      name.split("/").some((part) => ["", ".", ".."].includes(part))
    )
      return context.newResponse(null, 404);
    const file = files.get(name);
    if (
      !file ||
      (url.searchParams.has("v") && url.searchParams.get("v") !== mount.version)
    )
      return context.newResponse(null, 404);
    const absolute = path.join(root, name);
    try {
      const [resolved, metadata] = await Promise.all([
        realpath(absolute),
        lstat(absolute),
      ]);
      if (
        resolved !== absolute ||
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        metadata.size !== file.size_bytes
      )
        return context.newResponse(null, 404);
      const etag = `"${file.sha256}"`;
      const headers = new Headers({
        "Content-Type": file.media_type,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Cache-Control":
          url.searchParams.get("v") === mount.version
            ? "private, max-age=31536000, immutable"
            : "no-cache",
        ETag: etag,
      });
      if (context.req.header("if-none-match") === etag)
        return new Response(null, { status: 304, headers });
      let start = 0;
      let end = metadata.size - 1;
      let status = 200;
      const range = context.req.header("range");
      if (
        range &&
        (!context.req.header("if-range") ||
          context.req.header("if-range") === etag)
      ) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
        if (match && (match[1] || match[2])) {
          start = match[1]
            ? Number(match[1])
            : Math.max(0, metadata.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        } else start = -1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          end >= metadata.size
        ) {
          headers.set("Content-Range", `bytes */${metadata.size}`);
          return new Response(null, { status: 416, headers });
        }
        status = 206;
        headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
      }
      headers.set("Content-Length", String(Math.max(0, end - start + 1)));
      if (context.req.method === "HEAD" || !metadata.size)
        return new Response(null, { status, headers });
      const handle = await open(
        absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      return new Response(
        Readable.toWeb(
          handle.createReadStream({ start, end }),
        ) as ReadableStream<Uint8Array>,
        { status, headers },
      );
    } catch {
      return context.newResponse(null, 404);
    }
  };
}
