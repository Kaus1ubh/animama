import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * A speech-to-text set on the operator's host: the variable that carries its
 * read-only Compose mount and the offline resolver script reset.sh also uses.
 */
type HostModelSet = { mountVariable: string; script: string };

export const HOST_MODEL_SETS = {
  parakeet: {
    mountVariable: "VITE_CLIENT_PARAKEET_MODEL_DIR",
    script: "parakeet.py",
  },
  parakeetWebgpu: {
    mountVariable: "VITE_CLIENT_PARAKEET_WEBGPU_MODEL_DIR",
    script: "parakeet_webgpu.py",
  },
  sensevoice: {
    mountVariable: "VITE_CLIENT_SENSEVOICE_MODEL_DIR",
    script: "sensevoice.py",
  },
  sensevoiceWebgpu: {
    mountVariable: "VITE_CLIENT_SENSEVOICE_WEBGPU_MODEL_DIR",
    script: "sensevoice_webgpu.py",
  },
} as const satisfies Record<string, HostModelSet>;

function resolverScript(script: string): string {
  return fileURLToPath(
    new URL(`../../../../scripts/models/${script}`, import.meta.url),
  );
}

/**
 * Resolve a verified base set at server startup; builds need no model bytes.
 * The set is optional: `null` makes its route answer 404, and reset.sh reports
 * its dictation as not installed. A present set that fails verification still
 * blocks startup.
 */
export function resolveLocalModelDir({
  mountVariable,
  script,
}: HostModelSet): string | null {
  // Compose passes its already verified, read-only mount. Direct host Vite uses
  // the same offline resolver as reset.sh, with ANIMAMA_MODEL_ROOT if selected.
  const mounted = process.env[mountVariable]?.trim();
  if (mounted) {
    if (!path.isAbsolute(mounted) || !statSync(mounted).isDirectory()) {
      throw new Error(
        `${mountVariable} must be an existing absolute directory`,
      );
    }
    return mounted;
  }
  try {
    return execFileSync("python3", [resolverScript(script), "path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch (error) {
    // Exit status 2 means the set was never acquired.
    if ((error as { status?: number }).status === 2) return null;
    throw error;
  }
}

/**
 * Resolve an optional WebGPU add-on set. Unlike a base set it never blocks
 * startup: `null` makes its route answer 404, which the client reports as
 * "GPU model not installed".
 */
export function resolveOptionalLocalModelDir({
  mountVariable,
  script,
}: HostModelSet): string | null {
  const mounted = process.env[mountVariable]?.trim();
  if (mounted) {
    return path.isAbsolute(mounted) &&
      statSync(mounted, { throwIfNoEntry: false })?.isDirectory()
      ? mounted
      : null;
  }
  try {
    return execFileSync("python3", [resolverScript(script), "path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export type LocalFileAsset = {
  filePath: string;
  size: number;
  contentType: string;
  /** Strong validator for verified bytes; without it every request transfers them. */
  etag?: string;
};

export type MiddlewareServer = {
  middlewares: {
    use: (
      handler: (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ) => void,
    ) => void;
  };
};

function getStaticContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".onnx":
    default:
      return "application/octet-stream";
  }
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function getStatusCode(error: unknown): number {
  return error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

function serveLocalFileFromRoute({
  requestUrl,
  routeBaseUrl,
  rootDir,
}: {
  requestUrl: string | undefined;
  routeBaseUrl: string;
  rootDir: string | null;
}): LocalFileAsset | null {
  const pathname = requestUrl?.split("?")[0] ?? "";
  const normalizedRouteBaseUrl = routeBaseUrl.replace(/\/$/, "");
  if (
    pathname !== normalizedRouteBaseUrl &&
    !pathname.startsWith(`${normalizedRouteBaseUrl}/`)
  ) {
    return null;
  }

  const rawRelativePath = pathname
    .slice(normalizedRouteBaseUrl.length)
    .replace(/^\/+/, "");
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(rawRelativePath);
  } catch {
    throw httpError("Invalid URL encoding", 400);
  }

  if (rootDir === null) {
    throw httpError("Not found", 404);
  }
  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, relativePath);
  const pathFromRoot = path.relative(root, filePath);
  if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) {
    throw httpError("Forbidden", 403);
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw httpError("Not found", 404);
  }

  if (!stats.isFile()) {
    throw httpError("Not found", 404);
  }

  return {
    filePath,
    size: stats.size,
    contentType: getStaticContentType(filePath),
  };
}

function matchesEtag(condition: string | undefined, etag: string): boolean {
  return (
    condition
      ?.split(",")
      .some((value) => [etag, `W/${etag}`, "*"].includes(value.trim())) ?? false
  );
}

/** Serve a caller-owned allowlist with consistent byte-range behavior. */
export function installLocalAssetMiddleware(
  server: MiddlewareServer,
  resolveAsset: (requestUrl: string | undefined) => LocalFileAsset | null,
): void {
  server.middlewares.use((req, res, next) => {
    let asset: LocalFileAsset | null;
    try {
      asset = resolveAsset(req.url);
    } catch (error) {
      const statusCode = getStatusCode(error);
      const errorMessage =
        error instanceof Error ? error.message : "Internal Server Error";
      res.statusCode = statusCode;
      res.end(statusCode === 500 ? "Internal Server Error" : errorMessage);
      return;
    }

    if (!asset) {
      next();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    if (asset.etag) {
      res.setHeader("ETag", asset.etag);
      if (matchesEtag(req.headers["if-none-match"], asset.etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.contentType);
    let start = 0;
    let end = asset.size - 1;
    // One bounded byte range is enough for model loading. Ignore If-Range
    // without a matching validator and send the complete representation.
    const ifRange = req.headers["if-range"];
    const range =
      req.method === "GET" && (!ifRange || ifRange === asset.etag)
        ? req.headers.range
        : undefined;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
        } else {
          start = Math.max(0, asset.size - Number(match[2]));
        }
      }
      if (
        !match ||
        (!match[1] && !match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= asset.size
      ) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${asset.size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${asset.size}`);
    } else {
      res.statusCode = 200;
    }
    res.setHeader("Content-Length", Math.max(0, end - start + 1));
    if (req.method === "HEAD" || asset.size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(asset.filePath, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
}

export function localModelSetPlugin({
  modelDir,
  routeBaseUrl,
}: {
  modelDir: string | null | (() => string | null);
  routeBaseUrl: string;
}): Plugin {
  return {
    name: `anima-local-model-set:${routeBaseUrl}`,
    configureServer(server) {
      const rootDir = typeof modelDir === "function" ? modelDir() : modelDir;
      installLocalAssetMiddleware(server, (requestUrl) =>
        serveLocalFileFromRoute({ requestUrl, routeBaseUrl, rootDir }),
      );
    },
    configurePreviewServer(server) {
      const rootDir = typeof modelDir === "function" ? modelDir() : modelDir;
      installLocalAssetMiddleware(server, (requestUrl) =>
        serveLocalFileFromRoute({ requestUrl, routeBaseUrl, rootDir }),
      );
    },
  };
}
