import { createReadStream, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  MEDIA_ROUTE,
  PreviewMediaFiles,
  createPreviewMediaAdapter,
} from "./animation-preview-media.mjs";
import { openBrowser, sendJson, trustedRequest } from "./local-page-server.mjs";

/**
 * Landing page stage (spike): one Included Avatar on a full-viewport canvas,
 * moved between the landing page's camera stops by scrolling, playing each
 * stop's Gestures and Reactions with their Avatar, Particle and Scene Effects
 * through the app's own `Avatar` playback.
 *
 *   pnpm -s landing:stage [--port <n>] [--no-open] [--walk-clips <dir>]
 *
 * The page lists its stops in `landing-stage/stops.ts`; this server resolves
 * the Library clips and Scene Effects they name (as `animation:preview` does)
 * and serves their files. It also serves the hero entrance's clips by file
 * name: the harness's own (`landing-stage/clips/`, such as the head scratch)
 * and any in a `--walk-clips` folder, which can add walk cycles to compare
 * (`?walk=<id>`) or replace a bundled clip of the same name. Serves on
 * 127.0.0.1 only and writes nothing.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const avatarDir = path.join(repoRoot, "content/included/avatars");
const includedDir = path.join(repoRoot, "content/included");
const portraitDir = path.join(includedDir, "appearances/avatar-portraits");
const PAGE = "/scripts/landing-stage/index.html";
/**
 * Recharts (the emotion radar) imports `es-toolkit/compat/*`, which Vite's dep
 * optimizer mis-bundles; route each through the app's ESM wrapper, as
 * `vite.config.ts` does.
 */
const rechartsCompatDir = path.join(
  webRoot,
  "src/lib/recharts/es-toolkit-compat",
);
const rechartsCompatAliases = Object.fromEntries(
  readdirSync(rechartsCompatDir)
    .filter((file) => file.endsWith(".js"))
    .map((file) => [
      `es-toolkit/compat/${path.basename(file, ".js")}`,
      path.join(rechartsCompatDir, file),
    ]),
);
const PREVIEW_MODULES = "/src/lib/avatar/motion-authoring/preview";
const PORTRAIT_ROUTE = "/__stage/portrait/";

/**
 * Entrance clips are served by plain file name, from the harness's `clips/`
 * folder and `--walk-clips`, and nothing else.
 */
const WALK_ROUTE = "/__stage/walk/";
const WALK_FILE = /^[\w.-]+\.(vrma|clip\.json)$/;
const BUNDLED_CLIPS = path.join(webRoot, "scripts/landing-stage/clips");

/** Start the stage server. Resolves once it listens. */
export async function startStageServer({ port = 0, walkClips = null } = {}) {
  let origin = "";
  const roots = { cwd: process.cwd(), included: includedDir, local: null };
  const files = new PreviewMediaFiles();
  const media = createPreviewMediaAdapter({ files });

  const server = await createServer({
    configFile: false,
    root: webRoot,
    // Brand marks and emotion mascots come from the app's public folder.
    publicDir: path.join(webRoot, "public"),
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-landing-stage"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"landing-stage"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
        ...rechartsCompatAliases,
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, "scripts/landing-stage/stage.ts")],
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

  const { PreviewSession } = await server.ssrLoadModule(
    `${PREVIEW_MODULES}/previewSession.ts`,
  );
  const { STAGE_AVATARS, stageSources } = await server.ssrLoadModule(
    "/scripts/landing-stage/stops.ts",
  );

  /**
   * Every clip and Scene Effect the stops name, resolved once. A source that
   * fails to resolve is reported to the page instead of stopping the stage.
   */
  const program = { avatars: [], sources: {}, problems: [], walk: {} };
  // Entrance clips by file name: the bundled ones, then `--walk-clips`
  // (which wins on a shared name).
  const walkFiles = new Map();
  for (const folder of [BUNDLED_CLIPS, walkClips].filter(Boolean)) {
    try {
      for (const name of readdirSync(folder).filter((n) => WALK_FILE.test(n)))
        walkFiles.set(name, path.join(folder, name));
    } catch (error) {
      program.problems.push(`walk clips: ${error.message}`);
    }
  }
  program.walk = Object.fromEntries(
    [...walkFiles.keys()].map((name) => [name, `${WALK_ROUTE}${name}`]),
  );
  program.avatars = STAGE_AVATARS.map(({ id }) => ({
    id,
    url: `/@fs${path.join(avatarDir, `${id}.vrm`)}`,
  }));
  /** Portrait files by Avatar id, served at `/__stage/portrait/<id>`. */
  const portraits = new Map(
    STAGE_AVATARS.map(({ id, portrait }) => [
      id,
      path.join(portraitDir, portrait),
    ]),
  );
  for (const spec of stageSources()) {
    try {
      const session = await PreviewSession.open({
        sources: [spec],
        roots,
        media,
      });
      const [row] = session.state().rows;
      if (row.error) program.problems.push(`${spec}: ${row.error.message}`);
      else
        program.sources[spec] = {
          clip: row.clip,
          effect: row.effect,
          media: row.media,
        };
    } catch (error) {
      program.problems.push(`${spec}: ${error.message}`);
    }
  }

  async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(302, { location: PAGE }).end();
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
    else if (url.pathname === "/__stage/program")
      sendJson(response, 200, program);
    else if (url.pathname.startsWith(WALK_ROUTE)) sendWalkClip(response, url);
    else if (url.pathname.startsWith(PORTRAIT_ROUTE)) {
      // Only the listed Avatars' portraits, by id.
      const file = portraits.get(url.pathname.slice(PORTRAIT_ROUTE.length));
      if (!file) sendJson(response, 404, { error: "Not found" });
      else {
        response.writeHead(200, { "content-type": "image/webp" });
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
      }
    } else sendJson(response, 404, { error: "Not found" });
    return true;
  }

  /** Stream an entrance clip listed at start-up, and nothing else. */
  function sendWalkClip(response, url) {
    const name = url.pathname.slice(WALK_ROUTE.length);
    const file = walkFiles.get(name);
    if (!file) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, {
      "content-type": name.endsWith(".json")
        ? "application/json"
        : "model/gltf-binary",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  }

  /** Stream an effect file a resolved source offered to the page. */
  async function sendMediaFile(response, url) {
    const file = await files.lookup(url.pathname.slice(MEDIA_ROUTE.length));
    if (!file) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, {
      "content-type": PreviewMediaFiles.contentType(file),
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    });
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  }

  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    url: `${origin}${PAGE}`,
    problems: program.problems,
    close: () => server.close(),
  };
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
