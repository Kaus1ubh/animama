import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

type LocalFileAsset = {
  filePath: string;
  size: number;
  contentType: string;
};

type MiddlewareServer = {
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
  rootDir: string;
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

function installLocalParakeetModelMiddleware(
  server: MiddlewareServer,
  {
    modelDir,
    routeBaseUrl,
  }: {
    modelDir: string;
    routeBaseUrl: string;
  },
): void {
  server.middlewares.use((req, res, next) => {
    let asset: LocalFileAsset | null;
    try {
      asset = serveLocalFileFromRoute({
        requestUrl: req.url,
        routeBaseUrl,
        rootDir: modelDir,
      });
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

    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Length", asset.size);
    res.setHeader("Content-Type", asset.contentType);
    createReadStream(asset.filePath).pipe(res);
  });
}

export function localParakeetModelPlugin({
  modelDir,
  routeBaseUrl,
}: {
  modelDir: string;
  routeBaseUrl: string;
}): Plugin {
  return {
    name: "anima-local-parakeet-models",
    configureServer(server) {
      installLocalParakeetModelMiddleware(server, { modelDir, routeBaseUrl });
    },
    configurePreviewServer(server) {
      installLocalParakeetModelMiddleware(server, { modelDir, routeBaseUrl });
    },
  };
}
