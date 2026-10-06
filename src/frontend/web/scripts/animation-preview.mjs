import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/**
 * Live motion preview with review notes.
 *
 *   pnpm -s animation:preview <source> [--compare <source>] [--notes <file>]
 *     [--local-content <dir>] [--port <n>] [--no-open]
 *
 * Plays a clip, motion description, project envelope or Library item on both
 * Included Avatars through the app's own Avatar playback, in the system
 * browser. Serves on 127.0.0.1 only; writes only review notes and retained
 * versions (see src/lib/avatar/motion-authoring/preview/).
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const avatarDir = path.join(repoRoot, "content/included/avatars");
const includedDir = path.join(repoRoot, "content/included");
const AVATARS = ["AvatarSample_Y_0", "AvatarSample_A_1_New"];
const PAGE = "/scripts/animation-preview/index.html";
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Start the preview server. Resolves once it listens; `close()` stops the
 * server and its file watchers.
 */
export async function startPreviewServer({
  sources,
  notes,
  localContent,
  cwd,
  port = 0,
}) {
  const clients = new Set();
  let session;
  let origin = "";

  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-animation-preview"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"preview"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, "scripts/animation-preview/preview.ts")],
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: port !== 0,
      // No cross-origin reads: other local pages must not read notes or paths.
      cors: false,
      fs: { allow: [webRoot, avatarDir] },
    },
    plugins: [
      {
        name: "animama-animation-preview-api",
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

  /** Reject requests from other hosts or sites (DNS rebinding, CSRF). */
  const trusted = (request) => {
    if (`http://${request.headers.host ?? ""}` !== origin) return false;
    const requestOrigin = request.headers.origin;
    // Browsers send Origin on cross-origin GETs; writes must always carry ours.
    return requestOrigin === undefined
      ? request.method === "GET"
      : requestOrigin === origin;
  };

  async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(302, { location: PAGE }).end();
      return true;
    }
    if (!url.pathname.startsWith("/__preview/")) return false;
    if (!trusted(request)) {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const route = url.pathname.slice("/__preview/".length);
    if (request.method === "GET" && route === "state") {
      sendJson(response, 200, pageState(session.state()));
    } else if (request.method === "GET" && route === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`data: ${session.state().generation}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
    } else if (request.method === "GET" && route.startsWith("versions/")) {
      sendJson(
        response,
        200,
        await session.versionClip(route.slice("versions/".length)),
      );
    } else if (request.method === "POST" && route === "notes") {
      await respond(response, async () =>
        pageState(await session.addNote(await readJsonBody(request))),
      );
      broadcast();
    } else if (request.method === "DELETE" && route.startsWith("notes/")) {
      await respond(response, async () =>
        pageState(
          await session.deleteNote(
            decodeURIComponent(route.slice("notes/".length)),
          ),
        ),
      );
      broadcast();
    } else {
      sendJson(response, 404, { error: "Not found" });
    }
    return true;
  }

  /** Session state plus the Avatar files the page loads. */
  const pageState = (state) => ({
    ...state,
    avatars: AVATARS.map((id) => ({
      id,
      url: `/@fs${path.join(avatarDir, `${id}.vrm`)}`,
    })),
  });

  const broadcast = () => {
    for (const client of clients)
      client.write(`data: ${session.state().generation}\n\n`);
  };

  const { openPreviewSession } = await server.ssrLoadModule(
    "/src/lib/avatar/motion-authoring/preview/openPreviewSession.ts",
  );
  try {
    session = await openPreviewSession({
      sources,
      notes,
      roots: { cwd, included: includedDir, local: localContent ?? null },
      avatarDirectory: avatarDir,
    });
  } catch (error) {
    await server.close();
    throw error;
  }

  // Watch directories, not files: editors often replace files on save.
  let timer = null;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      session.reload().then(
        (changed) => changed && broadcast(),
        (error) => console.error(`Reload failed: ${error.message}`),
      );
    }, 120);
  };
  const watched = new Set(session.watchPaths);
  const watchers = [...new Set([...watched].map((file) => path.dirname(file)))]
    .map((dir) => {
      try {
        return watch(dir, (_event, name) => {
          if (name && watched.has(path.join(dir, name.toString()))) reload();
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(": keep-alive\n\n");
  }, 15_000);

  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    url: `${origin}${PAGE}`,
    origin,
    session,
    async close() {
      clearInterval(keepAlive);
      clearTimeout(timer);
      watchers.forEach((watcher) => watcher.close());
      for (const client of clients) client.end();
      await server.close();
    },
  };
}

async function respond(response, action) {
  try {
    sendJson(response, 200, await action());
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Expected a JSON body."));
      }
    });
    request.on("error", reject);
  });
}

/** Open the URL in the system's default (non-headless) browser. */
function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () =>
    console.log(`Could not open a browser; open ${url} yourself.`),
  );
  child.unref();
}

const USAGE = `Usage: pnpm -s animation:preview <source> [--compare <source>] [--notes <file>]
                                [--local-content <dir>] [--port <n>] [--no-open]

A source is a clip file (animaPoseClip/1.0), a motion description
(animamaMotion/1), a creator project envelope, or a Library item:
library:<folder | selector | name>, optionally prefixed included/ or local/.
Local items come from --local-content or the sourced stack's
ANIMAMA_LOCAL_CONTENT_HOST_PATH.

Review notes are saved beside a file source as <file name without .json>.review.json
(laugh.clip.json -> laugh.clip.review.json), or in the working directory for a
Library item, unless --notes names a file.`;

async function main(argv) {
  const values = {};
  const positional = [];
  let open = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(USAGE);
      return 0;
    }
    if (argument === "--no-open") open = false;
    else if (
      ["--compare", "--notes", "--local-content", "--port"].includes(argument)
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        console.log(`${argument} needs a value.\n\n${USAGE}`);
        return 2;
      }
      values[argument] = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      console.log(`Unknown option ${argument}.\n\n${USAGE}`);
      return 2;
    } else positional.push(argument);
  }
  const port = Number(values["--port"] ?? 0);
  if (positional.length !== 1 || !Number.isInteger(port) || port < 0) {
    console.log(USAGE);
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const localContent =
    values["--local-content"] ?? process.env.ANIMAMA_LOCAL_CONTENT_HOST_PATH;
  let preview;
  try {
    preview = await startPreviewServer({
      sources: values["--compare"]
        ? [positional[0], values["--compare"]]
        : [positional[0]],
      notes: values["--notes"],
      localContent: localContent ? path.resolve(cwd, localContent) : null,
      cwd,
      port,
    });
  } catch (error) {
    console.log(error.message);
    for (const issue of error.issues ?? [])
      console.log(`  ${issue.path}: ${issue.message}`);
    return 1;
  }
  console.log(`Preview: ${preview.url}`);
  console.log(`Review notes: ${preview.session.reviewPaths.sidecar}`);
  console.log("Press Ctrl+C to stop.");
  if (open) openBrowser(preview.url);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await preview.close();
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
