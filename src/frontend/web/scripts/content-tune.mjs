import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import { pageClipMedia } from "./effect-render.mjs";
import {
  INCLUDED_CONTENT_ROOT,
  REPO_ROOT,
  resolveDependencies,
} from "./effect-render-sources.mjs";
import {
  listTuneEffects,
  listTuneItems,
  listTuneSounds,
  listVendorCatalog,
  publicItem,
} from "./content-tune-model.mjs";
import { createTuneWriter } from "./content-tune-write.mjs";
import {
  PACK_SOUND_MANIFEST,
  SOUND_REF_PREFIX,
} from "./included-dependencies.mjs";
import {
  openBrowser,
  readJsonBody,
  respond,
  sendJson,
  trustedRequest,
} from "./local-page-server.mjs";

/**
 * The owner's content-tuning page for Included Gestures and Reactions.
 *
 *   pnpm -s content:tune [--catalog <dir>] [--sounds <dir>]... [--avatar annie|caitlyn]
 *     [--port <n>] [--no-open]
 *   pnpm -s content:tune --pending
 *
 * Lists every Included Gesture and the Reaction ladder, auditions the WOW
 * Sound catalog, previews an item, with its effects and sounds, on an
 * Included Avatar in the system browser, and saves the owner's edits to the
 * item's events and (for a Reaction) peak expressions straight into
 * `content/included`. Serves on 127.0.0.1 only. Licensed audio is read from
 * the owner's folders and never copied. `--pending` prints the pack sounds
 * Included content needs added or no longer uses, and exits.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const avatarDir = path.join(INCLUDED_CONTENT_ROOT, "avatars");
const PAGE = "/scripts/content-tune/index.html";
const API = "/__tune/";
// Room for every applied edit in one Save all.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const AVATARS = {
  annie: "AvatarSample_A_1_New",
  caitlyn: "AvatarSample_Y_0",
};
/**
 * The page's default port. Fixed, because applied (unsaved) edits live in
 * the browser's storage for the page's origin, port included: the same port
 * finds them again after a restart.
 */
export const DEFAULT_TUNE_PORT = 4791;
const DEFAULT_SOUND_ROOTS = [
  path.join(REPO_ROOT, "build-inputs/wow-comedy-sfx"),
];
const SOUND_TYPES = {
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
};

/**
 * Start the tuning server. Resolves once it listens; `close()` stops it.
 * `contentRoot` defaults to the checkout's Included content.
 */
export async function startTuneServer({
  contentRoot = INCLUDED_CONTENT_ROOT,
  catalogDir = null,
  soundRoots = DEFAULT_SOUND_ROOTS,
  avatar = "annie",
  port = 0,
}) {
  const avatarId = AVATARS[avatar] ?? avatar;
  const manifest = JSON.parse(
    await readFile(path.join(REPO_ROOT, PACK_SOUND_MANIFEST), "utf8"),
  );
  const sounds = await listTuneSounds({
    catalogDir,
    packRoots: soundRoots,
    manifest,
  });
  const soundFiles = new Map(
    sounds
      .filter((sound) => sound.file)
      .map((sound) => [sound.key, sound.file]),
  );
  const vfxRoot = path.join(INCLUDED_CONTENT_ROOT, "vfx");
  // Item paths are real paths; so is the root they're shown relative to.
  const realRepoRoot = await realpath(REPO_ROOT);
  let origin = "";

  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-content-tune"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"content-tune"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, "scripts/content-tune/index.html")],
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: port !== 0,
      // No cross-origin reads: other local pages must not read content.
      cors: false,
      fs: { strict: true, allow: [webRoot, avatarDir, vfxRoot] },
    },
    plugins: [
      {
        name: "animama-content-tune-api",
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

  // Effects come from the content root being edited when it has its own
  // (tests use a small fixture tree), else from the checkout's Included.
  const effectsRoot = existsSync(path.join(contentRoot, "vfx"))
    ? contentRoot
    : INCLUDED_CONTENT_ROOT;
  const effects = await listTuneEffects(effectsRoot);
  const clipFormat = await server.ssrLoadModule(
    "/src/lib/avatar/poses/animaPoseClip/index.ts",
  );
  const { default: prettier } = await import("prettier");
  const writer = createTuneWriter({
    repoRoot: REPO_ROOT,
    contentRoot,
    effectsRoot,
    includedTypes: new Map(
      effects.map((effect) => [effect.contentId, effect.contentType]),
    ),
    packSounds: new Set(sounds.map((sound) => sound.ref)),
    validateClip: clipFormat.validateAnimaPoseClipV2,
    maxClipBytes: clipFormat.MAX_ANIMA_POSE_CLIP_BYTES,
    formatJson: (value) =>
      prettier.format(JSON.stringify(value, null, 2), { parser: "json" }),
  });

  /** Reject requests from other hosts or sites (DNS rebinding, CSRF). */
  const trusted = (request) => trustedRequest(request, origin);

  const fsUrl = (file) => `/@fs${file}`;
  /** Effect images under the Included vfx folder are served; others inlined. */
  const imageUrl = async (file) => {
    if (!path.relative(vfxRoot, file).startsWith("..")) return fsUrl(file);
    const extension = path.extname(file).slice(1).toLowerCase();
    const type = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
    return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
  };

  async function state() {
    const items = await listTuneItems(contentRoot);
    return {
      avatar: {
        id: avatarId,
        url: fsUrl(path.join(avatarDir, `${avatarId}.vrm`)),
      },
      gestures: items.gestures.map(publicItem),
      reactions: items.reactions.map(publicItem),
      // Paths relative to the checkout, as the page shows them.
      problems: items.problems.map((problem) =>
        problem.replace(`${realRepoRoot}/`, ""),
      ),
      // Listed per request: Save all can change an effect's sound.
      effects: await listTuneEffects(effectsRoot),
      sounds: sounds.map(({ file, ...sound }) => ({
        ...sound,
        available: Boolean(file),
      })),
      catalog: Boolean(catalogDir) && sounds.some((sound) => !sound.shipped),
      // Names this checkout's content, so applied drafts kept in the browser
      // never cross to another worktree served on the same port.
      checkout: createHash("sha256")
        .update(contentRoot)
        .digest("hex")
        .slice(0, 16),
    };
  }

  async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(302, { location: PAGE }).end();
      return true;
    }
    if (!url.pathname.startsWith(API)) return false;
    if (!trusted(request)) {
      sendJson(response, 403, { error: "Forbidden" });
      return true;
    }
    const route = url.pathname.slice(API.length);
    if (request.method === "GET" && route === "state") {
      sendJson(response, 200, await state());
    } else if (request.method === "GET" && route.startsWith("sound/")) {
      sendSound(response, decodeURIComponent(route.slice("sound/".length)));
    } else if (request.method === "POST" && route === "media") {
      await respond(response, async () => {
        const { dependencies } = await readJsonBody(request, MAX_BODY_BYTES);
        const media = await resolveDependencies(dependencies);
        return {
          clipMedia: await pageClipMedia(media, { fsUrl, imageUrl }),
          notices: media.notices,
        };
      });
    } else if (request.method === "POST" && route === "save") {
      await respond(response, async () => {
        const { edits = [], effects = [] } = await readJsonBody(
          request,
          MAX_BODY_BYTES,
        );
        const saved = await writer.saveAll(edits, effects);
        return {
          ...saved,
          items: saved.items.map(publicItem),
          // Effects as the page lists them again.
          effects: (await listTuneEffects(effectsRoot)).filter((effect) =>
            saved.effects.some((one) => one.contentId === effect.contentId),
          ),
        };
      });
    } else if (request.method === "GET" && route === "pending") {
      await respond(response, () => writer.pending());
    } else {
      sendJson(response, 404, { error: "Not found" });
    }
    return true;
  }

  /** Stream one listed sound; any other key is not found. */
  function sendSound(response, key) {
    const file = soundFiles.get(key);
    if (!file) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, {
      "content-type":
        SOUND_TYPES[path.extname(file).toLowerCase()] ??
        "application/octet-stream",
      "cache-control": "no-store",
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
    origin,
    sounds,
    close: () => server.close(),
  };
}

const USAGE = `Usage: pnpm -s content:tune [--catalog <dir>] [--sounds <dir>]...
                           [--avatar annie|caitlyn] [--port <n>] [--no-open]

Opens the owner's tuning page for Included Gestures and the Reaction ladder:
audition WOW Sound catalog sounds and preview items, with their effects and
sounds, on an Included Avatar.

  --catalog <dir>   the vendor catalog folder (category subfolders of
                    AC_*.ogg files); defaults to ANIMAMA_WOW_SOUND_CATALOG.
                    Without it, only the pack's sounds are listed.
  --sounds <dir>    the comedy sound pack (repeatable); defaults to
                    build-inputs/wow-comedy-sfx. A worktree passes the primary
                    checkout's copy.
  --avatar          Included Avatar (default annie)
  --port <n>        serve on this port (default ${DEFAULT_TUNE_PORT}); applied,
                    unsaved edits are kept per port in the browser
  --pending         print the pack sounds Included content needs added to or
                    removed from the comedy pack (with --catalog, each
                    addition's vendor file), then exit

Saving writes the item's clip and meta in content/included. A changed
Gesture clip also needs its sample baseline updated (the page says how);
sounds outside the pack need a new pack version before the content merges.`;

export function parseTuneArgs(argv, env = process.env) {
  const options = {
    catalogDir: env.ANIMAMA_WOW_SOUND_CATALOG || null,
    soundRoots: [],
    avatar: "annie",
    port: DEFAULT_TUNE_PORT,
    open: true,
    help: false,
    pending: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--no-open") options.open = false;
    else if (argument === "--pending") options.pending = true;
    else if (
      ["--catalog", "--sounds", "--avatar", "--port"].includes(argument)
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${argument} needs a value.`);
      index += 1;
      if (argument === "--catalog") options.catalogDir = value;
      else if (argument === "--sounds") options.soundRoots.push(value);
      else if (argument === "--avatar") {
        if (!Object.hasOwn(AVATARS, value))
          throw new Error(
            `--avatar must be ${Object.keys(AVATARS).join(" or ")}.`,
          );
        options.avatar = value;
      } else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535)
          throw new Error("--port must be a port number.");
        options.port = port;
      }
    } else throw new Error(`Unknown option ${argument}.`);
  }
  if (!options.soundRoots.length) options.soundRoots = DEFAULT_SOUND_ROOTS;
  return options;
}

async function main(argv) {
  let options;
  try {
    options = parseTuneArgs(argv);
  } catch (error) {
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.pending) {
    const cwd = process.env.INIT_CWD ?? process.cwd();
    const { additions, removals } = await createTuneWriter({
      repoRoot: REPO_ROOT,
      contentRoot: INCLUDED_CONTENT_ROOT,
    }).pending();
    // The vendor file each addition copies, when the catalog is given.
    const catalogDir =
      options.catalogDir && path.resolve(cwd, options.catalogDir);
    const vendor = new Map(
      (await listVendorCatalog(catalogDir)).map((sound) => [
        `${SOUND_REF_PREFIX}${sound.key}`,
        path.relative(catalogDir, sound.file),
      ]),
    );
    for (const ref of additions)
      console.log(
        `Add to the pack: ${ref}${vendor.has(ref) ? ` (vendor file ${vendor.get(ref)})` : ""}`,
      );
    for (const ref of removals) console.log(`Remove from the pack: ${ref}`);
    if (!additions.length && !removals.length)
      console.log("The pack matches the sounds Included content plays.");
    return 0;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let tune;
  try {
    tune = await startTuneServer({
      catalogDir: options.catalogDir && path.resolve(cwd, options.catalogDir),
      soundRoots: options.soundRoots.map((root) => path.resolve(cwd, root)),
      avatar: options.avatar,
      port: options.port,
    });
  } catch (error) {
    // Vite reports a taken strict port by message, without an error code.
    if (error.code !== "EADDRINUSE" && !/already in use/i.test(error.message))
      throw error;
    console.log(
      `Port ${options.port} is in use: content:tune may already be running there. Stop it, or pass --port <n> (applied edits are kept per port).`,
    );
    return 1;
  }
  const shipped = tune.sounds.filter((sound) => sound.shipped).length;
  const playable = tune.sounds.filter((sound) => sound.file).length;
  console.log(`Content tuning: ${tune.url}`);
  console.log(
    `Sounds: ${tune.sounds.length} listed, ${shipped} in the pack, ${playable} playable.`,
  );
  if (
    options.catalogDir &&
    tune.sounds.every((sound) => sound.shipped || !sound.file)
  )
    console.log(
      `No vendor sounds found under ${options.catalogDir}: check the folder (category subfolders of AC_*.ogg files).`,
    );
  if (!options.catalogDir)
    console.log(
      "No vendor catalog: pass --catalog <dir> or set ANIMAMA_WOW_SOUND_CATALOG to list every sound.",
    );
  if (!playable)
    console.log(
      "No sound files found: pass --sounds <dir>, such as the primary checkout's build-inputs/wow-comedy-sfx.",
    );
  console.log("Press Ctrl+C to stop.");
  if (options.open) openBrowser(tune.url);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await tune.close();
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
