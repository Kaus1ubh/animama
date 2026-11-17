import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { compareReactions } from "./animation-reel.mjs";
import {
  MIN_REMAINING_SEC,
  clipFrom,
  includedAvatarFile,
  renameClipAliases,
  resolveAvatarFile,
} from "./animation-reel-sheet.mjs";
import {
  EffectSourceError,
  INCLUDED_CONTENT_ROOT,
  loadAnyEffectDescriptor,
  resolveClipSource,
  resolveDependencies,
  scanLibrary,
} from "./effect-render-sources.mjs";
import { pageClipMedia, pageEffect, pageParticle } from "./effect-render.mjs";
import { openBrowser, sendJson, trustedRequest } from "./local-page-server.mjs";

/**
 * Live combo page: try a Gesture, a Reaction and extra expression weights
 * together on an Avatar.
 *
 *   pnpm -s animation:combo [--avatar-file <file.vrm>]... [--avatar annie|andrew]...
 *     [--port <n>] [--no-open]
 *
 * Serves `scripts/animation-combo/` on 127.0.0.1: pick any Included Gesture
 * and Reaction, play them together as chat does (with their Avatar, Particle
 * and Scene Effects, no sounds), turn any Included Avatar or Particle Effect
 * on and off over them, add weight to any expression or ARKit shape
 * the Avatar has while watching its live weights, and copy the result as a
 * cue sheet take for `pnpm -s animation:reel --sheet`. Avatar files are read
 * in place; the page reads nothing else outside the web root and the
 * Included effects, and writes nothing.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const PAGE = "/scripts/animation-combo/index.html";
const INCLUDED_VFX_ROOT = path.join(INCLUDED_CONTENT_ROOT, "vfx");

const USAGE = [
  "Usage:",
  "  pnpm -s animation:combo [--avatar-file <file.vrm>]... [--avatar annie|andrew]... [--port <n>] [--no-open]",
  "",
  "Opens a live page that plays any Included Gesture and Reaction together on",
  "an Avatar, shows its live expression weights, adds weight to any expression",
  "or ARKit shape, and copies the result as an animation:reel cue sheet take.",
  "Each --avatar-file or --avatar (repeatable) adds an Avatar to its picker;",
  "with none, both Included Avatars. --port picks the port (default: any free",
  "one) and --no-open leaves the browser closed.",
].join("\n");

/** Parse argv; throws `EffectSourceError` on bad input. */
export function parseComboArgs(argv) {
  const avatars = [];
  let port = 0;
  let open = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { help: true };
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    const value = argv[index + 1];
    if (!["--avatar-file", "--avatar", "--port"].includes(arg))
      throw new EffectSourceError(`Unknown option ${arg}.`);
    if (value === undefined || value.startsWith("--"))
      throw new EffectSourceError(`${arg} needs a value.`);
    index += 1;
    if (arg === "--port") {
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new EffectSourceError(`Invalid --port ${value}.`);
    } else avatars.push({ value, file: arg === "--avatar-file" });
  }
  return {
    help: false,
    avatars: avatars.length
      ? avatars
      : [
          { value: "Annie", file: false },
          { value: "Andrew", file: false },
        ],
    port,
    open,
  };
}

/**
 * The key a dependency's effect is served under: its content id, plus its
 * config when it has one, so every clip naming the same effect shares it.
 */
export function mediaKey(dependency) {
  const config = dependency.config ?? {};
  return Object.keys(config).length
    ? `${dependency.ref}#${JSON.stringify(config)}`
    : dependency.ref;
}

/** A Library clip's picker entry. */
function pickerEntry(kind, stem, source, clip) {
  const hint = source.meta?.placement_hint ?? {};
  return {
    spec: `library:${kind}/${stem}`,
    stem,
    name:
      typeof source.meta?.name === "string"
        ? source.meta.name
        : (clip.name ?? stem),
    duration: Number(clip.duration) || 0,
    // The beats a Gesture can start from, as cue sheets accept them.
    beats: (Array.isArray(clip.beats) ? clip.beats : [])
      .filter(
        (beat) =>
          beat.time > 0 &&
          beat.time < (Number(clip.duration) || 0) - MIN_REMAINING_SEC,
      )
      .map((beat) => ({
        id: beat.id,
        time: beat.time,
        label: beat.label ?? beat.id,
      })),
    emotion: typeof hint.emotion === "string" ? hint.emotion : null,
    intensity: Number.isInteger(hint.intensity) ? hint.intensity : null,
  };
}

/**
 * Every Included Gesture (by stem) and Reaction (by emotion, then
 * intensity), their clips by spec with effect aliases keyed by content id
 * (`mediaKey`), the media those keys resolve to, and every Included Avatar
 * and Particle Effect (by stem) to apply on its own.
 */
export async function loadComboCatalog({ cwd = process.cwd() } = {}) {
  const lists = { gesture: [], reaction: [] };
  const clips = new Map();
  const dependencies = new Map();
  for (const kind of ["gesture", "reaction"]) {
    for (const { stem, descriptorPath } of await scanLibrary(
      INCLUDED_CONTENT_ROOT,
      kind,
    )) {
      const source = await resolveClipSource(descriptorPath, { cwd });
      const keyed = renameClipAliases(
        source.clip,
        (source.dependencies ?? []).filter(
          (dependency) => typeof dependency?.ref === "string",
        ),
        mediaKey,
      );
      for (const dependency of keyed.dependencies)
        dependencies.set(dependency.alias, dependency);
      const entry = pickerEntry(kind, stem, source, keyed.clip);
      clips.set(entry.spec, keyed.clip);
      lists[kind].push(entry);
    }
  }
  const effects = { avatar: [], particle: [] };
  for (const [kind, scan] of [
    ["avatar", "effect"],
    ["particle", "particle"],
  ])
    for (const { descriptorPath, descriptor } of await scanLibrary(
      INCLUDED_CONTENT_ROOT,
      scan,
    ))
      effects[kind].push(
        await loadAnyEffectDescriptor(descriptorPath, descriptor),
      );
  return {
    gestures: lists.gesture,
    reactions: lists.reaction.sort(compareReactions),
    clips,
    media: await resolveDependencies([...dependencies.values()]),
    avatarEffects: effects.avatar,
    particleEffects: effects.particle,
  };
}

/**
 * Start the page's server. Resolves once it listens with its `url`;
 * `close()` stops it.
 */
export async function startComboServer({
  avatars,
  port = 0,
  cwd = process.cwd(),
}) {
  const files = [];
  for (const { value, file } of avatars)
    files.push(
      await resolveAvatarFile(value, cwd, file ? "--avatar-file" : "--avatar", {
        file,
      }),
    );
  const catalog = await loadComboCatalog({ cwd });
  for (const notice of catalog.media.notices) console.log(`Warning: ${notice}`);
  const allow = [webRoot, INCLUDED_VFX_ROOT, ...files];
  const fsUrl = (file) => `/@fs${file}`;
  const page = {
    avatars: files.map((file, index) => ({
      id: path.basename(file).replace(/\.vrm$/i, ""),
      url: fsUrl(file),
      // What a cue sheet names it by: an Included Avatar's id, else its file.
      sheet:
        !avatars[index].file &&
        file === includedAvatarFile(avatars[index].value)
          ? path.basename(file).replace(/\.vrm$/i, "")
          : file,
    })),
    gestures: catalog.gestures,
    reactions: catalog.reactions,
    // Included effect art is inside the allowed roots, so served by URL.
    media: await pageClipMedia(catalog.media, {
      fsUrl,
      imageUrl: async (file) => fsUrl(file),
    }),
    avatarEffects: await Promise.all(
      catalog.avatarEffects.map((effect) =>
        pageEffect(effect, async (file) => fsUrl(file)),
      ),
    ),
    particleEffects: catalog.particleEffects.map((particle) =>
      pageParticle(particle, fsUrl),
    ),
  };
  let origin = "";
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-animation-combo"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"combo"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, "scripts/animation-combo/index.html")],
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: port !== 0,
      cors: false,
      fs: { strict: true, allow },
    },
    plugins: [
      {
        name: "animama-animation-combo-api",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            if (url.pathname === "/") {
              response.writeHead(302, { location: PAGE }).end();
              return;
            }
            if (!url.pathname.startsWith("/__combo/")) return next();
            // Other local pages must not read the catalog or Avatar paths.
            if (!trustedRequest(request, origin) || request.method !== "GET")
              return sendJson(response, 403, { error: "Forbidden" });
            const route = url.pathname.slice("/__combo/".length);
            if (route === "catalog") return sendJson(response, 200, page);
            if (route === "clip") {
              const clip = catalog.clips.get(url.searchParams.get("spec"));
              if (!clip)
                return sendJson(response, 404, { error: "No such clip." });
              // From a beat, prepared as the reel prepares it (`clipFrom`).
              const from = url.searchParams.get("from");
              const beat = from
                ? clip.beats?.find(({ id }) => id === from)
                : null;
              if (from && !beat)
                return sendJson(response, 404, { error: "No such beat." });
              return sendJson(
                response,
                200,
                beat ? clipFrom(clip, beat.time) : clip,
              );
            }
            sendJson(response, 404, { error: "Not found." });
          });
        },
      },
    ],
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  return { url: `${origin}${PAGE}`, close: () => server.close() };
}

async function main(argv) {
  let options;
  try {
    options = parseComboArgs(argv);
  } catch (error) {
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    const server = await startComboServer({
      ...options,
      cwd: process.env.INIT_CWD ?? process.cwd(),
    });
    console.log(`Combo page: ${server.url} (Ctrl+C stops it)`);
    if (options.open) openBrowser(server.url);
    return null;
  } catch (error) {
    if (error instanceof EffectSourceError) {
      console.log(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const code = await main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
