import {
  cpSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

export type IncludedContentAlias = {
  /** Existing root-relative URL retained until consumers use FastAPI delivery. */
  route: string;
  /** File or directory beneath the canonical Included root. */
  source: string;
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

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

export function resolveAliasFile(
  requestUrl: string | undefined,
  includedRoot: string,
  aliases: readonly IncludedContentAlias[],
): string | null {
  const encodedPathname = requestUrl?.split("?")[0] ?? "";
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return null;
  }

  const alias = [...aliases]
    .sort((left, right) => right.route.length - left.route.length)
    .find(
      (candidate) =>
        pathname === candidate.route ||
        pathname.startsWith(`${candidate.route}/`),
    );
  if (!alias) return null;

  const root = realpathSync(includedRoot);
  const configuredSource = path.resolve(root, alias.source);
  const configuredSourceRelativeToRoot = path.relative(root, configuredSource);
  if (
    configuredSourceRelativeToRoot.startsWith("..") ||
    path.isAbsolute(configuredSourceRelativeToRoot)
  ) {
    return null;
  }

  const source = realpathSync(configuredSource);
  const sourceRelativeToRoot = path.relative(root, source);
  if (
    sourceRelativeToRoot.startsWith("..") ||
    path.isAbsolute(sourceRelativeToRoot)
  ) {
    return null;
  }
  const sourceStats = lstatSync(source);
  const requestSuffix = pathname.slice(alias.route.length).replace(/^\/+/, "");
  const candidate = sourceStats.isDirectory()
    ? path.resolve(source, requestSuffix)
    : requestSuffix.length === 0
      ? source
      : "";
  if (!candidate) return null;

  let candidateStats;
  let resolvedCandidate;
  try {
    candidateStats = lstatSync(candidate);
    resolvedCandidate = realpathSync(candidate);
  } catch {
    return null;
  }
  const containmentRoot = sourceStats.isDirectory()
    ? source
    : path.dirname(source);
  const candidateRelativeToSource = path.relative(
    containmentRoot,
    resolvedCandidate,
  );
  if (
    candidateRelativeToSource.startsWith("..") ||
    path.isAbsolute(candidateRelativeToSource)
  ) {
    return null;
  }
  return candidateStats.isFile() && !candidateStats.isSymbolicLink()
    ? resolvedCandidate
    : null;
}

function installMiddleware(
  server: MiddlewareServer,
  includedRoot: string,
  aliases: readonly IncludedContentAlias[],
): void {
  server.middlewares.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    let filePath: string | null = null;
    try {
      filePath = resolveAliasFile(req.url, includedRoot, aliases);
    } catch {
      filePath = null;
    }
    if (!filePath) {
      next();
      return;
    }

    const stats = lstatSync(filePath);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Type", contentTypeFor(filePath));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  });
}

/**
 * Keeps current public URLs working while their source bytes live once in
 * `content/included`. Later runtime phases replace these aliases with opaque
 * registered FastAPI file references.
 */
export function includedContentCompatibilityPlugin({
  includedRoot,
  aliases,
  copyBuildAliases = true,
}: {
  includedRoot: string;
  aliases: readonly IncludedContentAlias[];
  /** Desktop gets typed bytes through FastAPI, not duplicated web aliases. */
  copyBuildAliases?: boolean;
}): Plugin {
  return {
    name: "animama-included-content-compatibility",
    configureServer(server) {
      installMiddleware(server, includedRoot, aliases);
    },
    configurePreviewServer(server) {
      installMiddleware(server, includedRoot, aliases);
    },
    writeBundle(outputOptions) {
      if (!copyBuildAliases) return;
      const outputRoot = path.resolve(outputOptions.dir ?? "dist");
      for (const alias of aliases) {
        const source = path.resolve(includedRoot, alias.source);
        const destination = path.resolve(outputRoot, alias.route.slice(1));
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(source, destination, { recursive: true, force: true });
      }
    },
  };
}
