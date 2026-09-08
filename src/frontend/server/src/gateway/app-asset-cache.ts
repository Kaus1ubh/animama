import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const IMMUTABLE_APP_ASSET_CACHE = "public, max-age=31536000, immutable";
const FINGERPRINTED_CODE = /^assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/** Only trusted build output can designate an immutable URL, never its spelling alone. */
export async function readBuildAssetInventory(
  root: string,
): Promise<ReadonlySet<string>> {
  try {
    const path = resolve(root, ".vite/manifest.json");
    if ((await stat(path)).size > MAX_MANIFEST_BYTES) return new Set();
    const manifest: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      return new Set();
    const paths = new Set<string>();
    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as {
        file?: unknown;
        css?: unknown;
        assets?: unknown;
      };
      for (const value of [
        record.file,
        ...(Array.isArray(record.css) ? record.css : []),
        ...(Array.isArray(record.assets) ? record.assets : []),
      ]) {
        if (typeof value === "string" && FINGERPRINTED_CODE.test(value))
          paths.add(`/${value}`);
      }
    }
    return paths;
  } catch {
    // An old/missing inventory degrades to revalidation, never guessed immutability.
    return new Set();
  }
}

/** Shared by packaged Hono and private Vite preview, after the response is known. */
export function appAssetCacheControl(
  inventory: ReadonlySet<string>,
  request: { pathname: string; method: string },
  response: { status: number; contentType?: string | null },
): string {
  const { pathname, method } = request;
  const { status, contentType } = response;
  if (status !== 200 && status !== 304) return "no-store";
  const expectedType = pathname.endsWith(".css")
    ? "text/css"
    : "text/javascript";
  const actualType = contentType?.split(";", 1)[0].trim().toLowerCase();
  const matchesType =
    actualType === expectedType ||
    (expectedType === "text/javascript" &&
      actualType === "application/javascript") ||
    (status === 304 && !actualType);
  return (method === "GET" || method === "HEAD") &&
    inventory.has(pathname) &&
    pathname.startsWith("/assets/") &&
    matchesType
    ? IMMUTABLE_APP_ASSET_CACHE
    : "no-cache";
}

/** Let preview retain its own streaming/conditional handling, then classify its final headers. */
export function installPreviewAssetCachePolicy(
  request: IncomingMessage,
  response: ServerResponse,
  inventory: ReadonlySet<string>,
): void {
  const originalWriteHead = response.writeHead;
  response.writeHead = function (
    statusCode,
    statusMessageOrHeaders?,
    headers?,
  ) {
    // Normalize explicit writeHead headers first so neither errors nor HTML
    // fallbacks inherit an optimistic cache classification from a request path.
    const explicitHeaders =
      typeof statusMessageOrHeaders === "string"
        ? headers
        : (statusMessageOrHeaders ?? headers);
    if (Array.isArray(explicitHeaders)) {
      for (let i = 0; i < explicitHeaders.length; i += 2)
        this.setHeader(
          String(explicitHeaders[i]),
          String(explicitHeaders[i + 1]),
        );
    } else if (explicitHeaders) {
      for (const [name, value] of Object.entries(explicitHeaders))
        if (value !== undefined) this.setHeader(name, value);
    }
    const contentType = this.getHeader("content-type");
    this.setHeader(
      "cache-control",
      appAssetCacheControl(
        inventory,
        {
          pathname: new URL(request.url ?? "/", "http://preview.local")
            .pathname,
          method: request.method ?? "GET",
        },
        {
          status: statusCode,
          contentType: typeof contentType === "string" ? contentType : null,
        },
      ),
    );
    if (typeof statusMessageOrHeaders === "string")
      this.statusMessage = statusMessageOrHeaders;
    return originalWriteHead.call(this, statusCode);
  };
}
