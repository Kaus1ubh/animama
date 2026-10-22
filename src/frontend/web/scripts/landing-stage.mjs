import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import { MEDIA_ROUTE, PreviewMediaFiles } from "./animation-preview-media.mjs";
import {
  PORTRAIT_ROUTE,
  WALK_ROUTE,
  avatarDir,
  contentTypeFor,
  pagePlugin,
  programPlugin,
  renderPageHtml,
  resolveStageProgram,
  siteIcons,
  stageDir,
  stageViteConfig,
  webRoot,
} from "./landing-stage-content.mjs";
import { openBrowser, sendJson, trustedRequest } from "./local-page-server.mjs";

/**
 * Landing page stage: one Included Avatar on a full-viewport canvas, moved
 * between the landing page's camera stops by scrolling, playing each stop's
 * Gestures and Reactions with their Avatar, Particle and Scene Effects
 * through the app's own `Avatar` playback. A local development server only:
 * it serves the whole web app's source and reads Library files by path, so
 * it must never be deployed; `pnpm -s landing:build` makes the public site.
 *
 *   pnpm -s landing:stage [--port <n>] [--no-open] [--walk-clips <dir>]
 *
 * The page lists its stops in `landing-stage/stops.ts`; this server resolves
 * the Library clips and effects they name (as `animation:preview` does),
 * hands them to the page as `virtual:landing-program` and serves their
 * files. It also serves the hero entrance's clips by file name: the page's
 * own (`landing-stage/clips/`, such as the head scratch) and any in a
 * `--walk-clips` folder, which can add walk cycles to compare (`?walk=<id>`)
 * or replace a bundled clip of the same name. Serves on 127.0.0.1 only and
 * writes nothing.
 */
const PAGE = "/scripts/landing-stage/index.html";
/** The page's `static/` files, served from the site root as the build does. */
const staticDir = path.join(stageDir, "static");

/** Start the stage server. Resolves once it listens. */
export async function startStageServer({ port = 0, walkClips = null } = {}) {
  let origin = "";
  let content = null;
  let page = null;
  const icons = await siteIcons();

  const server = await createServer({
    ...stageViteConfig(),
    // Brand marks and emotion mascots come from the app's public folder.
    publicDir: path.join(webRoot, "public"),
    optimizeDeps: {
      entries: [path.join(stageDir, "stage.ts")],
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: port !== 0,
      cors: false,
      // The workspace's node_modules holds hoisted packages such as the font.
      fs: { allow: [webRoot, path.join(webRoot, ".."), avatarDir] },
    },
    plugins: [
      programPlugin(() => content.program),
      pagePlugin(() => page),
      {
        name: "animama-landing-stage-api",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) =>
            handleApi(request, response).then(
              (handled) => (handled ? undefined : next()),
              (error) => sendJson(response, 500, { error: error.message }),
            ),
          );
        },
      },
    ],
  });
  content = await resolveStageProgram(server, { walkClips });
  page = await renderPageHtml(server);
  const { program, files, walkFiles, portraitFiles } = content;

  async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(302, { location: PAGE }).end();
      return true;
    }
    // The page's `static/` files and generated icons, at the site root.
    const name = path.basename(url.pathname);
    if (path.dirname(url.pathname) === "/" && icons.has(name)) {
      response.writeHead(200, {
        "content-type": contentTypeFor(name),
        "cache-control": "no-store",
      });
      response.end(icons.get(name));
      return true;
    }
    const staticFile = path.join(staticDir, name);
    if (
      path.dirname(url.pathname) === "/" &&
      url.pathname !== "/" &&
      existsSync(staticFile)
    ) {
      sendFile(response, staticFile, contentTypeFor(staticFile));
      return true;
    }
    const isApi = url.pathname.startsWith("/__stage/");
    const isMedia = url.pathname.startsWith(MEDIA_ROUTE);
    if (!isApi && !isMedia) return false;
    // Read-only: reject writes, other hosts (DNS rebinding) and cross-site reads.
    if (request.method !== "GET" || !trustedRequest(request, origin)) {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    if (isMedia) await sendMediaFile(response, url);
    else if (url.pathname.startsWith(WALK_ROUTE)) {
      // An entrance clip listed at start-up, and nothing else.
      const name = url.pathname.slice(WALK_ROUTE.length);
      const file = walkFiles.get(name);
      if (!file) sendJson(response, 404, { error: "Not found" });
      else sendFile(response, file, contentTypeFor(file));
    } else if (url.pathname.startsWith(PORTRAIT_ROUTE)) {
      // Only the listed Avatars' portraits, by id.
      const file = portraitFiles.get(url.pathname.slice(PORTRAIT_ROUTE.length));
      if (!file) sendJson(response, 404, { error: "Not found" });
      else sendFile(response, file, "image/webp");
    } else sendJson(response, 404, { error: "Not found" });
    return true;
  }

  /** Stream an effect file a resolved source offered to the page. */
  async function sendMediaFile(response, url) {
    const file = await files.lookup(url.pathname.slice(MEDIA_ROUTE.length));
    if (!file) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    sendFile(response, file, PreviewMediaFiles.contentType(file), {
      "content-security-policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    });
  }

  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    url: `${origin}${PAGE}`,
    problems: program.problems,
    close: () => server.close(),
  };
}

/** Stream one file, uncached, as `type`. */
function sendFile(response, file, type, headers = {}) {
  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  createReadStream(file)
    .on("error", () => response.destroy())
    .pipe(response);
}

const USAGE =
  "Usage: pnpm -s landing:stage [--port <n>] [--no-open] [--walk-clips <dir>]";

async function main(argv) {
  let port = 0;
  let open = true;
  let walkClips = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-open") open = false;
    else if (argument === "--walk-clips") {
      walkClips = path.resolve(argv[index + 1] ?? "");
      index += 1;
    } else if (argument === "--port") {
      port = Number(argv[index + 1]);
      index += 1;
    } else {
      console.log(USAGE);
      return argument === "--help" ? 0 : 2;
    }
  }
  if (!Number.isInteger(port) || port < 0) {
    console.log(USAGE);
    return 2;
  }
  const stage = await startStageServer({ port, walkClips });
  for (const problem of stage.problems) console.log(`Skipped ${problem}`);
  console.log(`Stage: ${stage.url}`);
  console.log("Press Ctrl+C to stop.");
  if (open) openBrowser(stage.url);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await stage.close();
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
