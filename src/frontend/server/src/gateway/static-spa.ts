import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type { Context } from "hono";
import {
  appAssetCacheControl,
  IMMUTABLE_APP_ASSET_CACHE,
  readBuildAssetInventory,
} from "./app-asset-cache.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  // ONNX ships ES modules separately from Vite's .js chunks. Browsers reject
  // dynamic imports served as application/octet-stream, even on loopback.
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function containedRegularFile(
  realRoot: Promise<string | null>,
  path: string,
): Promise<string | null> {
  try {
    const [root, candidate] = await Promise.all([realRoot, realpath(path)]);
    if (
      !root ||
      !contained(root, candidate) ||
      !(await stat(candidate)).isFile()
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

async function streamFile(
  path: string,
  request: Request,
  pathname: string,
  inventory: ReadonlySet<string>,
): Promise<Response> {
  const metadata = await stat(path);
  // Desktop staging normalizes mtimes. Same-sized HTML with new fingerprints
  // must not match an older build just because its timestamp was normalized.
  const html =
    extname(path).toLowerCase() === ".html"
      ? new Uint8Array(await readFile(path))
      : null;
  const contentType =
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const cacheControl = appAssetCacheControl(
    inventory,
    { pathname, method: request.method },
    { status: 200, contentType },
  );
  const fingerprinted = cacheControl === IMMUTABLE_APP_ASSET_CACHE;
  const etag = html
    ? `"${createHash("sha256").update(html).digest("hex")}"`
    : fingerprinted
      ? `W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}"`
      : null;
  const headers = new Headers({
    "content-length": String(html?.byteLength ?? metadata.size),
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "cache-control": cacheControl,
  });
  if (etag) headers.set("etag", etag);
  // Unversioned static resources keep the previous always-current 200 policy;
  // normalized timestamps cannot validate their contents across app versions.
  if (fingerprinted) headers.set("last-modified", metadata.mtime.toUTCString());
  const condition = request.headers.get("if-none-match");
  const modifiedSince = request.headers.get("if-modified-since");
  const unchanged =
    etag !== null &&
    (condition !== null
      ? condition
          .split(",")
          .some(
            (value) =>
              value.trim() === "*" ||
              value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""),
          )
      : !html &&
        modifiedSince !== null &&
        Math.floor(metadata.mtimeMs / 1000) * 1000 <=
          Date.parse(modifiedSince));
  const status = unchanged ? 304 : 200;
  if (unchanged) {
    headers.delete("content-length");
    return new Response(null, { status, headers });
  }
  const body =
    request.method === "HEAD"
      ? null
      : (html ??
        (Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>));
  return new Response(body, { status: 200, headers });
}

/** Recognize app documents without disguising API, model, or content requests as HTML. */
export function isSpaNavigation(
  decodedPath: string,
  headers: Headers,
): boolean {
  const reserved = [
    "/api",
    "/v1",
    "/_desktop",
    "/onnx",
    "/tts",
    "/basis",
    "/assets",
    "/content",
    "/background",
    "/effects",
  ];
  return (
    !reserved.some(
      (prefix) =>
        decodedPath === prefix || decodedPath.startsWith(`${prefix}/`),
    ) &&
    extname(decodedPath) === "" &&
    (headers.get("sec-fetch-mode") === "navigate" ||
      Boolean(headers.get("accept")?.includes("text/html")))
  );
}

/** Serve built assets and fall back to index.html only for navigation paths. */
export function createStaticSpaHandler(staticRoot: string) {
  const root = resolve(staticRoot);
  const indexPath = resolve(root, "index.html");
  const inventoryRoot = resolve(root, ".vite");
  const realRoot = realpath(root).catch(() => null);
  const inventory = readBuildAssetInventory(root);

  return async (c: Context): Promise<Response> => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.json({ error: "not_found" }, 404, {
        "cache-control": "no-store",
      });
    }
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.json({ error: "invalid_path" }, 400, {
        "cache-control": "no-store",
      });
    }
    const candidate = resolve(root, `.${decodedPath}`);
    if (!contained(root, candidate) || contained(inventoryRoot, candidate)) {
      return c.json({ error: "not_found" }, 404, {
        "cache-control": "no-store",
      });
    }
    const regularCandidate = await containedRegularFile(realRoot, candidate);
    if (regularCandidate) {
      return streamFile(
        regularCandidate,
        c.req.raw,
        decodedPath,
        await inventory,
      );
    }

    const regularIndex = await containedRegularFile(realRoot, indexPath);
    if (!isSpaNavigation(decodedPath, c.req.raw.headers) || !regularIndex) {
      return c.json({ error: "not_found" }, 404, {
        "cache-control": "no-store",
      });
    }
    return streamFile(regularIndex, c.req.raw, "/index.html", await inventory);
  };
}
