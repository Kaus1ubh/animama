import { createReadStream, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import {
  MAX_PREVIEW_DURATION_SEC,
  MEDIA_ROUTE,
  PreviewMediaFiles,
  createPreviewMediaAdapter,
} from "./animation-preview-media.mjs";
import {
  openBrowser,
  readJsonBody,
  respond,
  sendJson,
  trustedRequest,
} from "./local-page-server.mjs";

/**
 * Live motion and Avatar Effect preview with review notes.
 *
 *   pnpm -s animation:preview [<source>] [--compare <source>] [--notes <file>]
 *     [--duration <s>] [--local-content <dir>] [--port <n>] [--no-open]
 *
 * Plays a clip, project envelope, Library Gesture or Reaction (with its
 * Avatar, Particle and Scene Effects), or an Avatar, Particle or Scene Effect
 * source on both Included Avatars through the app's own Avatar playback and
 * Scene layers, in the system browser. The page's pickers switch to any clip
 * beside a file source, any Library Gesture or Reaction and any Library
 * effect without a restart. Serves on 127.0.0.1 only; writes only review
 * notes and retained versions (see src/lib/avatar/motion-authoring/preview/).
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const avatarDir = path.join(repoRoot, "content/included/avatars");
const includedDir = path.join(repoRoot, "content/included");
const AVATARS = ["Andrew", "Annie"];
const PAGE = "/scripts/animation-preview/index.html";
const PREVIEW_MODULES = "/src/lib/avatar/motion-authoring/preview";
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
  duration = null,
  port = 0,
}) {
  const clients = new Set();
  /** The open session and its file watchers; replaced when the page picks. */
  let current;
  let origin = "";
  const roots = { cwd, included: includedDir, local: localContent ?? null };
  const files = new PreviewMediaFiles();
  const media = createPreviewMediaAdapter({ files, duration });
  const effectSpecs = [];
  for (const spec of sources)
    if (await media.resolve(spec, roots).catch(() => null))
      effectSpecs.push(spec);
  // Picker folders: the folders of clip files named here (Library items and
  // effect sources are listed separately).
  const choiceDirs = [
    ...new Set(
      sources
        .filter((spec) => !spec.startsWith("library:"))
        .filter((spec) => !effectSpecs.includes(spec))
        .map((spec) => path.dirname(path.resolve(cwd, spec))),
    ),
  ];

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
  const trusted = (request) => trustedRequest(request, origin);

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
      sendJson(response, 200, pageState(current.session.state()));
    } else if (request.method === "GET" && route === "choices") {
      sendJson(response, 200, await listChoices());
    } else if (request.method === "POST" && route === "select") {
      await respond(response, async () =>
        pageState(await select(await readJsonBody(request, MAX_BODY_BYTES))),
      );
      broadcast();
    } else if (request.method === "GET" && route === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`data: ${current.session.state().generation}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
    } else if (
      request.method === "GET" &&
      url.pathname.startsWith(MEDIA_ROUTE)
    ) {
      await sendMediaFile(response, url);
    } else if (request.method === "GET" && route.startsWith("versions/")) {
      sendJson(
        response,
        200,
        await current.session.versionClip(route.slice("versions/".length)),
      );
    } else if (request.method === "POST" && route === "notes") {
      await respond(response, async () =>
        pageState(
          await current.session.addNote(
            await readJsonBody(request, MAX_BODY_BYTES),
          ),
        ),
      );
      broadcast();
    } else if (request.method === "DELETE" && route.startsWith("notes/")) {
      await respond(response, async () =>
        pageState(
          await current.session.deleteNote(
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

  /** Stream an effect file the session offered to the page. */
  async function sendMediaFile(response, url) {
    const file = await files.lookup(url.pathname.slice(MEDIA_ROUTE.length));
    if (!file) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, {
      "content-type": PreviewMediaFiles.contentType(file),
      // Files change while reviewed (and may change back), so never cache.
      "cache-control": "no-store",
      // Effect files are data: an SVG opened on its own runs no script.
      "content-security-policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    });
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  }

  const broadcast = () => {
    for (const client of clients)
      client.write(`data: ${current.session.state().generation}\n\n`);
  };

  const { PreviewSession } = await server.ssrLoadModule(
    `${PREVIEW_MODULES}/previewSession.ts`,
  );
  const { listPreviewChoices } = await server.ssrLoadModule(
    `${PREVIEW_MODULES}/sources.ts`,
  );
  const listChoices = async () => [
    ...(await listPreviewChoices(roots, choiceDirs)),
    ...(await media.choices(roots, effectSpecs)),
  ];

  /** Open a session for `specs` and watch its files. */
  async function openSession(specs, notesFile) {
    const session = await PreviewSession.open({
      sources: specs,
      notes: notesFile,
      roots,
      media,
    });
    // Watch directories, not files: editors often replace files on save.
    let timer = null;
    let closed = false;
    let watched = new Set();
    let watchedKey = null;
    let watchers = [];
    /**
     * Watch the session's files (which change when a descriptor names other
     * images) and, recursively, each effect source's folder, so an image that
     * is missing when named reloads the source once it appears.
     */
    const syncWatchers = () => {
      const files = new Set(session.watchPaths);
      const folders = new Set(session.watchDirs);
      const next = [...files, "", ...folders].join("\n");
      if (closed || next === watchedKey) return;
      watchers.forEach((watcher) => watcher.close());
      watchedKey = next;
      watched = files;
      const watchOne = (dir, options, matches) => {
        try {
          return watch(dir, options, (_event, name) => {
            if (name && matches(name.toString())) reload();
          });
        } catch {
          return null;
        }
      };
      watchers = [
        ...[...folders].map((dir) =>
          watchOne(dir, { recursive: true }, () => true),
        ),
        ...[...new Set([...watched].map((file) => path.dirname(file)))]
          .filter((dir) => !folders.has(dir))
          .map((dir) =>
            watchOne(dir, {}, (name) => watched.has(path.join(dir, name))),
          ),
      ].filter(Boolean);
    };
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        session.reload().then(
          (changed) => {
            syncWatchers();
            if (changed) broadcast();
          },
          (error) => console.error(`Reload failed: ${error.message}`),
        );
      }, 120);
    };
    syncWatchers();
    return {
      session,
      close() {
        closed = true;
        clearTimeout(timer);
        watchers.forEach((watcher) => watcher.close());
      },
    };
  }

  /**
   * Switch to sources the page picked. Only listed choices are accepted, so
   * the page cannot make the server read other files. The open session stays
   * if the new one cannot open.
   */
  let switching = Promise.resolve();
  /** The command-line source's file, which keeps `--notes`. */
  let initialPath;
  function select(body) {
    const next = switching.then(async () => {
      const { source, compare = null } = body ?? {};
      const choices = await listChoices();
      const listed = new Set(choices.map(({ spec }) => spec));
      if (typeof source !== "string" || !listed.has(source))
        throw new Error("Pick a listed source to review.");
      if (
        compare !== null &&
        (typeof compare !== "string" || !listed.has(compare))
      )
        throw new Error("Pick a listed source to compare with.");
      // --notes stays with the source it was given for.
      const { path: picked } = choices.find(({ spec }) => spec === source);
      const opened = await openSession(
        compare ? [source, compare] : [source],
        picked === initialPath ? notes : undefined,
      );
      // Number after everything the old session showed, so pages take it.
      opened.session.continueAfter(current.session.state().generation);
      current.close();
      current = opened;
      return current.session.state();
    });
    switching = next.catch(() => undefined);
    return next;
  }

  try {
    const initial =
      sources.length > 0 ? sources : [(await listChoices())[0]?.spec];
    if (!initial[0]) throw new Error("No clips to preview: name a source.");
    current = await openSession(initial, notes);
    initialPath = current.session.state().rows[0].path;
  } catch (error) {
    await server.close();
    throw error;
  }
  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(": keep-alive\n\n");
  }, 15_000);

  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    url: `${origin}${PAGE}`,
    origin,
    get session() {
      return current.session;
    },
    async close() {
      clearInterval(keepAlive);
      // A pick in flight installs its session first, then it is closed.
      await switching;
      current.close();
      for (const client of clients) client.end();
      await server.close();
    },
  };
}

const USAGE = `Usage: pnpm -s animation:preview [<source>] [--compare <source>] [--notes <file>]
                                [--duration <s>] [--local-content <dir>] [--port <n>] [--no-open]

A source is an animaPoseClip/2.0 clip file, a creator project
envelope, a Library Gesture or Reaction, or an Avatar, Particle or Scene
Effect:
  library:<folder | selector | name>, optionally prefixed included/ or local/
  an effect folder or descriptor .json
  library:avatar-effect/, library:particle-effect/ or library:scene-effect/
    then <stem | content_id | name>, optionally prefixed included/ or local/
Local items come from --local-content or the sourced stack's
ANIMAMA_LOCAL_CONTENT_HOST_PATH.

A Gesture or Reaction plays its Avatar, Particle and Scene Effects as in
chat. An effect source loops; --duration applies it for that many seconds (up
to ${MAX_PREVIEW_DURATION_SEC}) and then removes it. Changing a descriptor or any file it plays
(images, manifest, textures) reloads it.
Keep each effect descriptor in its own <stem>/ folder: that folder is watched
recursively, so unrelated files beside it would also reload the effect.

The page's Review and Compare pickers list the clips in the folder of each
file source named here, the Library's Gestures, Reactions and Avatar,
Particle and Scene Effects, and the effect sources named here. Without a source, the first listed item
plays.

Review notes are saved beside a file source as <file name without .json>.review.json
(laugh.clip.json -> laugh.clip.review.json) or beside an effect's folder
(sparkle/ -> sparkle.review.json). They go in the working directory instead for
a Library item and for any file inside Library content: under the Included or
Local root, in a vfx/avatar/<stem>/, vfx/scene/<stem>/ or
vfx/particle/[quark/]<stem>/ folder, or in a <stem>/ folder that holds
<stem>.meta.json. --notes names another file (for the sources named here).`;

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
      [
        "--compare",
        "--notes",
        "--duration",
        "--local-content",
        "--port",
      ].includes(argument)
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
  const duration =
    values["--duration"] === undefined ? null : Number(values["--duration"]);
  if (
    positional.length > 1 ||
    (positional.length === 0 && values["--compare"]) ||
    !Number.isInteger(port) ||
    port < 0 ||
    (duration !== null &&
      !(duration > 0 && duration <= MAX_PREVIEW_DURATION_SEC))
  ) {
    console.log(USAGE);
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const localContent =
    values["--local-content"] ?? process.env.ANIMAMA_LOCAL_CONTENT_HOST_PATH;
  let preview;
  try {
    preview = await startPreviewServer({
      sources: [...positional, values["--compare"]].filter(Boolean),
      notes: values["--notes"],
      localContent: localContent ? path.resolve(cwd, localContent) : null,
      cwd,
      duration,
      port,
    });
  } catch (error) {
    console.log(error.message);
    for (const issue of error.issues ?? [])
      console.log(`  ${issue.path}: ${issue.message}`);
    return 1;
  }
  console.log(`Preview: ${preview.url}`);
  // The clip files, so a Library item can be copied and revised.
  for (const row of preview.session.state().rows)
    console.log(
      `${row.role === "main" ? "Reviewing" : "Comparing"}: ${row.label} (${row.path})`,
    );
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
