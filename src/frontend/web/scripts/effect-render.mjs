import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

import sharp from "sharp";

import { resolveAvatarFile } from "./avatar-file.mjs";
import { readMetadata } from "./effect-assets.mjs";
import {
  EffectSourceError,
  INCLUDED_CONTENT_ROOT,
  REPO_ROOT,
  isInside,
  listIncludedEffects,
  resolveAnyEffectSource,
  resolveClipSource,
  resolveDependencies,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

/**
 * Headless review renders for Avatar, Particle and Scene Effects on both
 * Included Avatars.
 *
 *   pnpm -s effects:render <source...>|--all-included --out <file.png|dir>
 *   pnpm -s effects:render <source> --thumbnail <out.webp>
 *   pnpm -s effects:render --diff <a.png> <b.png> [--out diff.png]
 *
 * A source is an effect folder, a descriptor `.json`, or
 * `library:[avatar-effect/|particle-effect/|scene-effect/][included/|local/]<stem|content_id|name>`
 * (an Avatar Effect when no kind is named). The page mounts real `Avatar`s,
 * applies Avatar Effects and plays Particle Effects through the runtime
 * paths, and draws Scene Effects in DOM bands around the canvas as the chat
 * does; see `effect-render/render.ts`. Node captures each tile from the page.
 * A run fails when an apply leaves a controller warning or no active effect,
 * because apply calls never throw, and when an applied Avatar Effect's art
 * draws nothing visible where it belongs or draws mostly outside the head
 * (see `measureArt`).
 *
 * Diff tolerance: a pixel differs when any RGBA channel differs by more than
 * `--threshold` (default 8 of 255), which absorbs antialiasing and float
 * rounding noise. Renders of the same source and revision are expected to
 * report 0 differing pixels; investigate any non-zero share.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const avatarDir = path.join(REPO_ROOT, "content/included/avatars");
/** Included effect folders the page may read directly. */
const INCLUDED_VFX_ROOT = path.join(INCLUDED_CONTENT_ROOT, "vfx");
const HEADER_PX = 28;
const LABEL_PX = 64;
const PAGE_BACKGROUND = "#f4f3ef";
const VIEW_LABELS = {
  front: "front",
  "three-quarter": "3/4 right",
  face: "face",
};
/** Avatar renderings `--rendering` accepts (`src/lib/avatar/enhanced-rendering`). */
export const AVATAR_RENDERINGS = ["enhanced", "classic"];
/** Avatar material settings `--materials` accepts (`src/lib/avatar/avatarSettings.ts`). */
export const AVATAR_MATERIAL_MODES = ["automatic", "liltoon", "simple"];
/** The Included Avatars every sheet and benchmark covers. */
export const AVATARS = ["Andrew", "Annie"];

/** The page URL of an Included Avatar's VRM. */
export const avatarFileUrl = (fsUrl, id) =>
  fsUrl(path.join(avatarDir, `${id}.vrm`));
/** Annie, the Library thumbnail Avatar. */
const THUMBNAIL_AVATAR = "Annie";

export const DEFAULT_TIMES = [0.1, 0.5, 1, 2];
export const DEFAULT_TILE = { width: 256, height: 320 };
export const VIEW_NAMES = ["front", "three-quarter", "face"];
export const DEFAULT_THRESHOLD = 8;
/**
 * Share of a tile's pixels an Avatar Effect's art must change, in at least
 * one tile of each Avatar, to count as visible (`effects check` uses it too).
 */
export const VISIBLE_SHARE = 0.001;
/** Least share of a face or head effect's changed pixels on the head. */
export const MIN_HEAD_SHARE = 0.5;
/**
 * How far around the head art placed at a face landmark (the eyes, mouth,
 * forehead or top) may reach: the head rect grows by this share of its width
 * and height per side.
 */
export const HEAD_HOVER_MARGIN = 0.5;
/** Longest supported time after applying; frames are stepped one by one. */
export const MAX_TIME_SEC = 30;
const VIEW_ALIASES = { "3/4": "three-quarter", "¾": "three-quarter" };
const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Raised after every requested effect was attempted, when any failed. */
export class EffectRenderFailure extends Error {
  constructor(results) {
    const failed = results.filter((result) => result.failures.length);
    super(
      failed
        .map((result) => `${result.stem}: ${result.failures.join("; ")}`)
        .join("\n"),
    );
    this.name = "EffectRenderFailure";
    this.results = results;
  }
}

/** Failures for one Avatar's diagnostics after applying `expected` effects. */
function avatarFailures(avatar, expected = 1) {
  const failures = avatar.warnings.map(
    (warning) => `${avatar.id} warning: ${truncate(warning)}`,
  );
  if (expected === 0) return failures;
  if (!avatar.applied || avatar.activeEffectIds.length === 0)
    failures.push(`${avatar.id} has no active effect`);
  else if (avatar.activeEffectIds.length < expected)
    failures.push(
      `${avatar.id} has ${avatar.activeEffectIds.length} of ${expected} effects active`,
    );
  return failures;
}

function truncate(text, limit = 240) {
  // Inline images appear in load-failure messages as long data URLs.
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Software WebGL: deterministic review renders on any machine. */
const SWIFTSHADER_LAUNCH = {
  headless: true,
  // A preinstalled Chromium, where Playwright's own download is unavailable.
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
};

/**
 * Start a page, run `callback({ page, fsUrl, imageUrl, server })`, and always
 * shut down. Vite serves only the web root, the Included Avatars, the
 * Included effects, an optional local content root and `extraRoots` (the
 * folders of the sources being reviewed); any other effect image is inlined.
 * `pageDir` names the page under `scripts/` (default the review renderer); it
 * must set `window.effectRendererReady`. `launch` holds the Playwright
 * Chromium launch options plus an optional page `viewport` and
 * `deviceScaleFactor`. `rendering` picks the app's enhanced (default) or
 * classic Avatar rendering; `materials` the Avatar's material setting
 * (Automatic by default; Simple draws a lilToon Avatar's fallback materials).
 */
export async function withRendererPage(
  {
    localContent,
    extraRoots = [],
    pageDir = "effect-render",
    launch = SWIFTSHADER_LAUNCH,
    rendering = "enhanced",
    materials = "automatic",
  },
  callback,
) {
  const allow = [webRoot, avatarDir, INCLUDED_VFX_ROOT, ...extraRoots];
  if (localContent) allow.push(localContent);
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-effect-render"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"render"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, `scripts/${pageDir}/index.html`)],
    },
    server: { host: "127.0.0.1", port: 0, fs: { strict: true, allow } },
  });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const { viewport, deviceScaleFactor, ...launchOptions } = launch;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({
      ...(viewport ? { viewport } : {}),
      ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    });
    await page.addInitScript(
      (value) => {
        window.__animamaRenderingOverride = value.rendering;
        window.__animamaMaterialModeOverride = value.materials;
      },
      { rendering, materials },
    );
    const errors = [];
    // Any page error (including a failed module import) ends the wait early.
    const pageError = new Promise((_, reject) =>
      page.on("pageerror", (error) => {
        errors.push(error.message);
        reject(error);
      }),
    );
    pageError.catch(() => undefined);
    await page.goto(`${origin}/scripts/${pageDir}/index.html`);
    await Promise.race([
      page.waitForFunction(() => window.effectRendererReady === true, null, {
        timeout: 120_000,
      }),
      pageError,
    ]);
    const fsUrl = (file) => `${origin}/@fs${file}`;
    const imageUrl = async (file) => {
      if (allow.slice(1).some((root) => isInside(file, root)))
        return fsUrl(file);
      const type =
        IMAGE_TYPES[path.extname(file).toLowerCase()] ??
        "application/octet-stream";
      return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
    };
    const result = await callback({ page, fsUrl, imageUrl, server });
    if (errors.length) throw new Error(errors.join("\n"));
    return result;
  } finally {
    // Close the server even when the browser fails to close.
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}

export async function pageEffect(effect, imageUrl) {
  return {
    stem: effect.stem,
    contentId: effect.contentId,
    name: effect.name,
    description: effect.description,
    definition: effect.definition,
    imageUrl: await imageUrl(effect.imagePath),
    otherImageUrl: effect.otherImagePath
      ? await imageUrl(effect.otherImagePath)
      : null,
    soundCueId: effect.soundRef ?? null,
    soundCueIds: effect.soundRefs ?? {},
  };
}

function decodeDataUrl(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** A Particle source as the page plays it: served manifest and defaults. */
export function pageParticle(
  particle,
  fsUrl,
  alias = particle.contentId,
  config = {},
) {
  return {
    alias,
    name: particle.name,
    description: particle.description,
    // Its relative texture URLs resolve beside the served manifest.
    manifestUrl: fsUrl(particle.manifestPath),
    // As the runtime projection merges them for a dependency.
    config: { ...particle.defaults, ...config },
  };
}

/** A Scene source as the page shows it: definition and served images. */
export async function pageScene(scene, imageUrl, alias = scene.contentId) {
  const imageUrls = {};
  for (const [logicalName, file] of Object.entries(scene.imagePaths))
    imageUrls[logicalName] = await imageUrl(file);
  return { alias, name: scene.name, definition: scene.definition, imageUrls };
}

/** Sources of any kind, as the page applies them together. */
export async function pageSources(sources, { fsUrl, imageUrl }) {
  const page = { effects: [], particles: [], scenes: [] };
  for (const source of sources) {
    if (source.kind === "particle")
      page.particles.push(pageParticle(source, fsUrl));
    else if (source.kind === "scene")
      page.scenes.push(await pageScene(source, imageUrl));
    else page.effects.push(await pageEffect(source, imageUrl));
  }
  return page;
}

/** A clip's resolved dependencies, by alias, as the page plays its events. */
export async function pageClipMedia(media, { fsUrl, imageUrl }) {
  if (!media) return null;
  return {
    avatarEffects: await Promise.all(
      media.avatarEffects.map(async ({ alias, effect }) => ({
        alias,
        effect: await pageEffect(effect, imageUrl),
      })),
    ),
    particleEffects: media.particleEffects.map(({ alias, particle, config }) =>
      pageParticle(particle, fsUrl, alias, config),
    ),
    sceneEffects: await Promise.all(
      media.sceneEffects.map(({ alias, scene }) =>
        pageScene(scene, imageUrl, alias),
      ),
    ),
  };
}

/**
 * Real paths of the folders the page must read for these sources and clip
 * effects (Vite compares served files by their real path).
 */
export async function sourceRoots(sources, media = null) {
  const folders = await Promise.all(
    [
      ...sources,
      ...(media?.avatarEffects.map(({ effect }) => effect) ?? []),
      ...(media?.particleEffects.map(({ particle }) => particle) ?? []),
      ...(media?.sceneEffects.map(({ scene }) => scene) ?? []),
    ].map((source) => realpath(path.dirname(source.descriptorPath))),
  );
  return [...new Set(folders)];
}

/**
 * Open a stage for each Included Avatar with `request` applied and capture
 * one tile per time and view from the page. Returns the parse error, or per
 * Avatar its diagnostics after applying (warnings from every frame included),
 * its PNG tiles as `frames[time][view]` and where it is in each tile as
 * `layouts[time][view]`: `{ headRect, artInView }` (`headRect` is null
 * when the Avatar has no head box; see `effect-render/tileLayout.ts`).
 */
export async function captureStage(page, { request, avatars, times, views }) {
  await page.setViewportSize({
    width: Math.max(1280, request.tile.width),
    height: Math.max(720, request.tile.height),
  });
  const captured = [];
  for (const avatar of avatars) {
    const opened = await page.evaluate(
      (stageRequest) => window.openReviewStage(stageRequest),
      { ...request, avatar },
    );
    if (opened.parseError)
      return { parseError: opened.parseError, avatars: [] };
    const warnings = new Set(opened.avatar.warnings);
    // A clip's events start effects after opening; count them from frames.
    const active = new Set(opened.avatar.activeEffectIds);
    let missingPoseRefs = opened.avatar.missingPoseRefs;
    const frames = [];
    const layouts = [];
    try {
      for (const time of times) {
        const row = [];
        const rects = [];
        for (const view of views) {
          const frame = await page.evaluate(
            ([frameTime, frameView]) =>
              window.showReviewFrame(frameTime, frameView),
            [time, view],
          );
          frame.warnings.forEach((warning) => warnings.add(warning));
          frame.activeEffectIds.forEach((id) => active.add(id));
          missingPoseRefs = frame.missingPoseRefs;
          row.push(await page.locator("#review-stage").screenshot());
          rects.push(frame.layout);
        }
        frames.push(row);
        layouts.push(rects);
      }
    } finally {
      await page.evaluate(() => window.closeReviewStage());
    }
    captured.push({
      ...opened.avatar,
      id: avatar.id,
      activeEffectIds: [...active],
      warnings: [...warnings],
      missingPoseRefs,
      frames,
      layouts,
    });
  }
  return { parseError: null, avatars: captured };
}

/**
 * Largest RGBA channel difference of the pixel at byte `offset` in two raw
 * RGBA buffers.
 */
export function pixelDelta(left, right, offset) {
  let delta = 0;
  for (let channel = 0; channel < 4; channel += 1)
    delta = Math.max(
      delta,
      Math.abs(left[offset + channel] - right[offset + channel]),
    );
  return delta;
}

/** A fully transparent PNG data URL the size of `file`. */
export async function transparentStandIn(file) {
  const { width, height } = await readMetadata(file);
  const png = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * An Avatar Effect (resolved `effect`, and `paged` as `pageEffect` returns
 * it) as the art checks' baseline applies it. A face effect keeps its face
 * options (closed or cleaned eyes, hidden parts) whatever its art, so the
 * baseline applies it with fully transparent stand-in images and only the
 * art differs. Other attachments are left out (null): a tinted silhouette
 * fills even with transparent art.
 */
export async function artBaselineEffect(effect, paged) {
  const kind = effect.definition?.attachment?.kind;
  if (kind !== "face_landmark" && kind !== "face_surface") return null;
  return {
    ...paged,
    imageUrl: await transparentStandIn(effect.imagePath),
    otherImageUrl: effect.otherImagePath
      ? await transparentStandIn(effect.otherImagePath)
      : null,
  };
}

/**
 * Where an Avatar Effect's art belongs in a tile: `face` for art painted on
 * a face part (the head's rect), `head` for art placed at a face landmark,
 * which may sit beside the eyes or mouth, at the forehead or above the head
 * (the head's rect grown by `HEAD_HOVER_MARGIN`), and `tile` for body,
 * sticker and silhouette art (anywhere).
 */
export function artRegionKind(definition) {
  const kind = definition?.attachment?.kind;
  if (kind === "face_surface") return "face";
  return kind === "face_landmark" ? "head" : "tile";
}

/**
 * The rect of a `width × height` tile where art of region `kind` belongs:
 * null (the whole tile) for `tile` art or when the Avatar has no head rect.
 */
export function artRegionRect(kind, headRect, { width, height }) {
  if (kind === "tile" || !headRect) return null;
  if (kind === "face") return headRect;
  const grow = (span) => Math.round(span * HEAD_HOVER_MARGIN);
  const dx = grow(headRect.x1 - headRect.x0);
  const dy = grow(headRect.y1 - headRect.y0);
  return {
    x0: Math.max(0, headRect.x0 - dx),
    y0: Math.max(0, headRect.y0 - dy),
    x1: Math.min(width, headRect.x1 + dx),
    y1: Math.min(height, headRect.y1 + dy),
  };
}

/** A PNG decoded to raw RGBA bytes. */
export const rawRgba = (png) => sharp(png).ensureAlpha().raw().toBuffer();

/**
 * Pixels of one tile that changed between raw RGBA buffers `after` and
 * `before`: a pixel changes when a channel differs by more than `threshold`.
 * `inside` counts those within `rect` of a tile `width` pixels wide (every
 * changed pixel when `rect` is null).
 */
export function countChangedPixels(
  after,
  before,
  { threshold = DEFAULT_THRESHOLD, rect = null, width = 0 } = {},
) {
  let changed = 0;
  let inside = 0;
  for (let offset = 0; offset < after.length; offset += 4) {
    if (pixelDelta(after, before, offset) <= threshold) continue;
    changed += 1;
    if (!rect) {
      inside += 1;
      continue;
    }
    const pixel = offset / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1) inside += 1;
  }
  return { changed, inside };
}

/**
 * The face view frames the head alone (its head rect fills most of the
 * tile), so where art lands around the head is judged in the other views.
 */
const CLOSE_UP_VIEWS = new Set(["face"]);

/**
 * Measure what one Avatar Effect's art changes on one Avatar: each tile of
 * `frames` (with the art) against the same tile of `baseline` (same pose,
 * time and camera, without it), counted in the region `kind` names, with
 * each tile's `layouts` entry. Returns the region kind, the changed pixels
 * in all tiles, the most changed in the region in one tile (`peak`, with its
 * time and view), whether every tile had a head rect, body or sticker art's
 * effect `artId` and whether its centre was in any tile (`artSeen`), and
 * `wide`: the changed pixels and those in the region in the views other than
 * the face close-up, with those views' labels.
 */
export async function measureArt({
  frames,
  baseline,
  layouts,
  kind,
  artId = null,
  times,
  views,
  tile,
  threshold = DEFAULT_THRESHOLD,
}) {
  const measured = {
    kind,
    changed: 0,
    peak: 0,
    peakAt: null,
    headFound: true,
    artId,
    artSeen: false,
    wide: {
      views: views
        .filter((view) => !CLOSE_UP_VIEWS.has(view))
        .map((view) => VIEW_LABELS[view]),
      changed: 0,
      inside: 0,
    },
  };
  for (const [timeIndex, row] of frames.entries()) {
    for (const [viewIndex, png] of row.entries()) {
      const { headRect, artInView } = layouts[timeIndex][viewIndex];
      if (!headRect) measured.headFound = false;
      if (artInView.includes(artId)) measured.artSeen = true;
      const [after, before] = await Promise.all([
        rawRgba(png),
        rawRgba(baseline[timeIndex][viewIndex]),
      ]);
      const { changed, inside } = countChangedPixels(after, before, {
        threshold,
        rect: artRegionRect(kind, headRect, tile),
        width: tile.width,
      });
      measured.changed += changed;
      if (!CLOSE_UP_VIEWS.has(views[viewIndex])) {
        measured.wide.changed += changed;
        measured.wide.inside += inside;
      }
      if (!measured.peakAt || inside > measured.peak) {
        measured.peak = inside;
        measured.peakAt = { time: times[timeIndex], view: views[viewIndex] };
      }
    }
  }
  return measured;
}

const ART_REGION_LABELS = {
  face: "on the head",
  head: "on or around the head",
  tile: "in the tile",
};

/**
 * Failures of Avatar Effect `effect` on one Avatar from its `measureArt`
 * result in `tile`-sized tiles. Art that changes fewer than `VISIBLE_SHARE`
 * of a tile inside its region in every tile draws nothing visible. Face and
 * landmark art draws mostly outside the head when, in the wide views, it
 * changes at least that many pixels but less than `MIN_HEAD_SHARE` of them
 * are in its region; this is judged only when every tile had a head rect
 * (otherwise the region is the whole tile) and the wide views were rendered.
 * Body or sticker art centred in no tile (art in a hand hanging below the
 * frame in the rest pose) is not judged.
 */
export function artFailures(avatarId, effect, measured, tile) {
  if (measured.artId && !measured.artSeen) return [];
  const floor = Math.ceil(tile.width * tile.height * VISIBLE_SHARE);
  const where = ART_REGION_LABELS[measured.headFound ? measured.kind : "tile"];
  if (measured.peak < floor) {
    const { peak, peakAt } = measured;
    const most = peak
      ? `at most ${peak} px changed there in a tile (${VIEW_LABELS[peakAt.view]}, ${peakAt.time}s)`
      : "no pixel changed there";
    return [
      `${avatarId}: ${effect} draws nothing visible ${where}: ${most}, ${floor} needed in a tile; ${measured.changed} px changed in all tiles`,
    ];
  }
  const { wide } = measured;
  if (measured.kind === "tile" || !measured.headFound || wide.changed < floor)
    return [];
  const share = wide.inside / wide.changed;
  return share < MIN_HEAD_SHARE
    ? [
        `${avatarId}: ${effect} draws mostly outside the head: ${(share * 100).toFixed(1)}% of the ${wide.changed} px it changes in the ${wide.views.join(" and ")} views are ${where} (${MIN_HEAD_SHARE * 100}% needed)`,
      ]
    : [];
}

/** Why an Avatar Effect's art was not judged on an Avatar (`artNote`). */
const ART_NOT_JUDGED = {
  outside: "art outside every tile",
  inactive: "not active at any rendered time",
};

/**
 * A note that Avatar Effect `effect`'s art was not judged on one Avatar, for
 * `reason` (`outside`: body or sticker art centred in no tile; `inactive`: a
 * clip's effect active at no rendered time). Notes do not fail the run; they
 * tell a pass from an effect the review could not see.
 */
export function artNote(avatarId, effect, reason) {
  return `${avatarId}: ${effect} not judged (${ART_NOT_JUDGED[reason]})`;
}

const escapeXml = (text) =>
  text.replace(
    /[<>&"]/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char],
  );

/**
 * A contact sheet: rows are `times`, columns are `views` for each Avatar,
 * with a header row and a time column.
 */
export async function composeSheet({ avatars, times, views, tile }) {
  const columns = avatars.length * views.length;
  const width = LABEL_PX + columns * tile.width;
  const height = HEADER_PX + times.length * tile.height;
  const labels = [
    ...times.map(
      (time, row) =>
        `<text x="8" y="${HEADER_PX + row * tile.height + 18}">${time.toFixed(2)}s</text>`,
    ),
    ...avatars.flatMap((avatar, avatarIndex) =>
      views.map(
        (view, viewIndex) =>
          `<text x="${LABEL_PX + (avatarIndex * views.length + viewIndex) * tile.width + 6}" y="18">${escapeXml(`${avatar.id.replace("AvatarSample_", "")} · ${VIEW_LABELS[view]}`)}</text>`,
      ),
    ),
  ];
  const tiles = avatars.flatMap((avatar, avatarIndex) =>
    avatar.frames.flatMap((row, timeIndex) =>
      row.map((input, viewIndex) => ({
        input,
        left: LABEL_PX + (avatarIndex * views.length + viewIndex) * tile.width,
        top: HEADER_PX + timeIndex * tile.height,
      })),
    ),
  );
  const text = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="sans-serif" font-size="13" fill="#222">${labels.join("")}</g></svg>`,
  );
  return sharp({
    create: { width, height, channels: 4, background: PAGE_BACKGROUND },
  })
    .composite([...tiles, { input: text, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

const isAvatarEffectSource = (source) =>
  source.kind !== "particle" && source.kind !== "scene";

/** `items` with entry `index` replaced by `replacement`, or left out for null. */
const replaceAt = (items, index, replacement) =>
  items.flatMap((item, at) =>
    at !== index ? [item] : replacement ? [replacement] : [],
  );

/**
 * Check where each of a sheet's Avatar Effects draws: those in `group` and
 * those the clip's events play (`clipMedia`, as resolved, by alias); with
 * none, the sheet keeps its result. For each effect, each Avatar that has
 * not already failed is captured again from `request` with only that
 * effect's art taken out (`artBaselineEffect`), so the pose, clip, mood face
 * and the other effects are in both captures and only its art differs.
 * Particle and Scene Effects are left out of these captures (the sheet's own
 * capture is reused when it has none): particles fall differently when art
 * loads by another path, and Scene layers vary by a few pixels between
 * captures. An effect the clip plays is judged only on Avatars where it was
 * active at a rendered time. Each effect's `measureArt` result is added to
 * `result.avatars[i].art` (`{ effect, ...measured }`), its `artFailures` to
 * `result.failures`, and an `artNote` to `result.notes` for each Avatar it
 * was not judged on.
 */
async function checkSheetArt(
  page,
  { group, clipMedia, request, avatars, captured, result, times, views, tile },
) {
  const direct = group.filter(isAvatarEffectSource);
  const played = clipMedia?.avatarEffects ?? [];
  if (!direct.length && !played.length) return;
  const checked = captured.avatars.filter(
    (avatar) => !avatarFailures(avatar, group.length).length,
  );
  if (!checked.length) return;
  const checkedAvatars = avatars.filter((avatar) =>
    checked.some((entry) => entry.id === avatar.id),
  );
  const media = request.clipMedia;
  const others =
    request.particles.length +
    request.scenes.length +
    (media?.particleEffects.length ?? 0) +
    (media?.sceneEffects.length ?? 0);
  const artRequest = {
    ...request,
    particles: [],
    scenes: [],
    clipMedia: media && { ...media, particleEffects: [], sceneEffects: [] },
  };
  const withArt = others
    ? (
        await captureStage(page, {
          request: artRequest,
          avatars: checkedAvatars,
          times,
          views,
        })
      ).avatars
    : checked;
  // `pageSources` and `pageClipMedia` keep the resolved effects' order.
  const subjects = [
    ...direct.map((effect, index) => ({
      name: effect.stem,
      id: effect.contentId,
      played: false,
      definition: effect.definition,
      baseline: async () => ({
        ...artRequest,
        effects: replaceAt(
          artRequest.effects,
          index,
          await artBaselineEffect(effect, artRequest.effects[index]),
        ),
      }),
    })),
    ...played.map(({ alias, effect }, index) => ({
      name: alias,
      id: alias,
      played: true,
      definition: effect.definition,
      baseline: async () => {
        const standIn = await artBaselineEffect(
          effect,
          media.avatarEffects[index].effect,
        );
        return {
          ...artRequest,
          clipMedia: {
            ...artRequest.clipMedia,
            avatarEffects: replaceAt(
              artRequest.clipMedia.avatarEffects,
              index,
              standIn && { alias, effect: standIn },
            ),
          },
        };
      },
    })),
  ];
  // A clip event's effect not active at any rendered time is not on screen.
  const shown = (subject, avatar) =>
    !subject.played || avatar.activeEffectIds.includes(subject.id);
  for (const subject of subjects) {
    const unshown = withArt.filter((avatar) => !shown(subject, avatar));
    for (const avatar of unshown)
      result.notes.push(artNote(avatar.id, subject.name, "inactive"));
    if (unshown.length === withArt.length) continue;
    const baseline = await captureStage(page, {
      request: await subject.baseline(),
      avatars: checkedAvatars,
      times,
      views,
    });
    for (const [index, avatar] of withArt.entries()) {
      if (!shown(subject, avatar)) continue;
      const measured = await measureArt({
        frames: avatar.frames,
        baseline: baseline.avatars[index].frames,
        layouts: avatar.layouts,
        kind: artRegionKind(subject.definition),
        // Body and sticker art draws on a plane the page finds by effect id.
        artId: ["body", "sticker"].includes(
          subject.definition?.attachment?.kind,
        )
          ? subject.id
          : null,
        times,
        views,
        tile,
      });
      const entry = result.avatars.find((item) => item.id === avatar.id);
      (entry.art ??= []).push({ effect: subject.name, ...measured });
      if (measured.artId && !measured.artSeen)
        result.notes.push(artNote(avatar.id, subject.name, "outside"));
      result.failures.push(
        ...artFailures(avatar.id, subject.name, measured, tile),
      );
    }
  }
}

/**
 * Render one contact sheet per source: rows are `times` after applying,
 * columns are `views` for each Included Avatar. Sources may be Avatar,
 * Particle or Scene Effects. With `together`, all sources are applied at
 * once on a single sheet (stem `a+b+c`), to check that they coexist. A
 * `clip` with `clipMedia` plays its effect events as chat would; with no
 * sources it is rendered on its own (`clipStem`). Each sheet with Avatar
 * Effects is also checked for art that draws nothing visible or draws
 * mostly outside the head (`checkSheetArt`). Every sheet is attempted and
 * written even when it fails, then `EffectRenderFailure` is thrown if any
 * failed.
 */
export async function renderEffectSheets({
  effects,
  together = false,
  outFileFor,
  times = DEFAULT_TIMES,
  tile = DEFAULT_TILE,
  views = VIEW_NAMES,
  expression = null,
  clip = null,
  clipMedia = null,
  clipStem = "clip",
  localContent = null,
  rendering = "enhanced",
  materials = "automatic",
  avatarFile = null,
  onResult,
}) {
  const results = await withRendererPage(
    {
      localContent,
      extraRoots: [
        ...(await sourceRoots(effects, clipMedia)),
        // Vite allows single files, so only the Avatar itself is served.
        ...(avatarFile ? [avatarFile] : []),
      ],
      rendering,
      materials,
    },
    async ({ page, fsUrl, imageUrl }) => {
      // A local Avatar file replaces both Included Avatars.
      const avatars = avatarFile
        ? [
            {
              id: path.basename(avatarFile).replace(/\.vrm$/i, ""),
              url: fsUrl(avatarFile),
            },
          ]
        : AVATARS.map((id) => ({ id, url: avatarFileUrl(fsUrl, id) }));
      const results = [];
      const groups = effects.length
        ? together
          ? [effects]
          : effects.map((effect) => [effect])
        : [[]];
      const media = await pageClipMedia(clipMedia, { fsUrl, imageUrl });
      for (const group of groups) {
        const stem = group.length
          ? group.map((effect) => effect.stem).join("+")
          : clipStem;
        const result = { stem, outFile: null, failures: [], notes: [] };
        try {
          const request = {
            ...(await pageSources(group, { fsUrl, imageUrl })),
            tile,
            expression,
            clip,
            clipMedia: media,
          };
          const captured = await captureStage(page, {
            request,
            avatars,
            times,
            views,
          });
          if (captured.parseError)
            throw new Error(`definition: ${captured.parseError}`);
          result.avatars = captured.avatars.map(
            ({ frames: _frames, layouts: _layouts, ...avatar }) => avatar,
          );
          result.failures = result.avatars.flatMap((avatar) =>
            avatarFailures(avatar, group.length),
          );
          result.outFile = outFileFor(group.length === 1 ? group[0] : { stem });
          await mkdir(path.dirname(result.outFile), { recursive: true });
          await writeFile(
            result.outFile,
            await composeSheet({
              avatars: captured.avatars,
              times,
              views,
              tile,
            }),
          );
          await checkSheetArt(page, {
            group,
            clipMedia,
            request,
            avatars,
            captured,
            result,
            times,
            views,
            tile,
          });
        } catch (error) {
          result.failures.push(
            truncate(error instanceof Error ? error.message : String(error)),
          );
        }
        onResult?.(result);
        results.push(result);
      }
      return results;
    },
  );
  if (results.some((result) => result.failures.length))
    throw new EffectRenderFailure(results);
  return results;
}

/**
 * Render and write one thumbnail on an open renderer page. The file is written
 * even when the render reports failures, so it can be inspected.
 */
async function writeThumbnailOnPage(
  { page, fsUrl, imageUrl },
  {
    effect,
    outFile,
    time,
    size,
    expression,
    clip,
    framingScale = 1,
    framingDrop = 0,
  },
) {
  const rendered = await page.evaluate(
    (request) => window.renderEffectThumbnail(request),
    {
      effects: [await pageEffect(effect, imageUrl)],
      avatar: {
        id: THUMBNAIL_AVATAR,
        url: avatarFileUrl(fsUrl, THUMBNAIL_AVATAR),
      },
      time,
      size,
      expression,
      clip,
      framingScale,
      framingDrop,
    },
  );
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, decodeDataUrl(rendered.dataUrl));
  return {
    stem: effect.stem,
    outFile,
    avatars: rendered.avatars,
    failures: rendered.avatars.flatMap(avatarFailures),
  };
}

/** Render a square WebP Library thumbnail of one effect on Annie. */
export async function renderEffectThumbnail({
  effect,
  outFile,
  time = 1,
  size = 512,
  expression = null,
  clip = null,
  localContent = null,
  rendering = "enhanced",
}) {
  const result = await withRendererPage(
    { localContent, rendering },
    (context) =>
      writeThumbnailOnPage(context, {
        effect,
        outFile,
        time,
        size,
        expression,
        clip,
      }),
  );
  if (result.failures.length) throw new EffectRenderFailure([result]);
  return result;
}

/**
 * Render several thumbnails on one renderer page (one Vite server and browser
 * for the whole batch). `jobs` are
 * `{ effect, outFile, framingScale?, framingDrop?, time?, clip? }`: `time`
 * overrides the batch's, and `clip` (parsed Gesture clip JSON) poses the
 * Avatar, sampled at the same time after applying as `--with-clip`. Every job is attempted;
 * `EffectRenderFailure` is thrown afterwards if any failed.
 */
export async function renderEffectThumbnails({
  jobs,
  time = 1,
  size = 512,
  onResult,
}) {
  const results = await withRendererPage({}, async (context) => {
    const results = [];
    for (const {
      effect,
      outFile,
      framingScale,
      framingDrop,
      time: jobTime,
      clip,
    } of jobs) {
      let result;
      try {
        result = await writeThumbnailOnPage(context, {
          effect,
          outFile,
          time: jobTime ?? time,
          size,
          expression: null,
          clip: clip ?? null,
          framingScale,
          framingDrop,
        });
      } catch (error) {
        result = {
          stem: effect.stem,
          outFile,
          failures: [
            truncate(error instanceof Error ? error.message : String(error)),
          ],
        };
      }
      onResult?.(result);
      results.push(result);
    }
    return results;
  });
  if (results.some((result) => result.failures.length))
    throw new EffectRenderFailure(results);
  return results;
}

/**
 * Compare two equally sized images. Returns the share of pixels whose largest
 * channel delta exceeds `threshold`, the maximum channel delta, and (when
 * `outFile` is given) writes a diff image: differing pixels in red, scaled by
 * their delta, over a faded greyscale copy of `a`.
 */
export async function diffImages(a, b, { outFile, threshold } = {}) {
  const limit = threshold ?? DEFAULT_THRESHOLD;
  const { default: sharp } = await import("sharp");
  const read = (file) =>
    sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [left, right] = await Promise.all([read(a), read(b)]);
  const { width, height } = left.info;
  if (width !== right.info.width || height !== right.info.height) {
    throw new Error(
      `Image sizes differ: ${width}×${height} and ${right.info.width}×${right.info.height}.`,
    );
  }
  const pixels = width * height;
  const diff = Buffer.alloc(pixels * 4);
  let differing = 0;
  let maxDelta = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const delta = pixelDelta(left.data, right.data, offset);
    maxDelta = Math.max(maxDelta, delta);
    if (delta > limit) {
      differing += 1;
      diff[offset] = 128 + Math.round((delta / 255) * 127);
      diff[offset + 1] = 0;
      diff[offset + 2] = 0;
    } else {
      const grey = Math.round(
        (left.data[offset] + left.data[offset + 1] + left.data[offset + 2]) / 3,
      );
      diff.fill(192 + Math.round(grey / 4), offset, offset + 3);
    }
    diff[offset + 3] = 255;
  }
  if (outFile) {
    await mkdir(path.dirname(outFile), { recursive: true });
    await sharp(diff, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(outFile);
  }
  return {
    width,
    height,
    threshold: limit,
    differingPixels: differing,
    differingShare: differing / pixels,
    maxChannelDelta: maxDelta,
  };
}

const USAGE = [
  "Usage:",
  "  pnpm -s effects:render <source...> --out <file.png|dir> [options]",
  "  pnpm -s effects:render --all-included --out <dir> [options]",
  "  pnpm -s effects:render <source> --thumbnail <out.webp> [--times 1] [--size 512]",
  "  pnpm -s effects:render --diff <a.png> <b.png> [--out diff.png] [--threshold 8]",
  "",
  "A source is an Avatar, Particle or Scene effect folder, a descriptor .json, or",
  "library:[particle-effect/|scene-effect/][included/|local/]<stem|content_id|name>",
  "(an Avatar Effect without a kind). Each sheet has one row per time after",
  "applying and, per Included Avatar, one tile per view; Scene Effects show behind",
  "and in front of the Avatar as in chat. With several sources --out is a",
  "directory receiving <stem>.png.",
  "",
  "Options:",
  `  --times 0.1,0.5,1,2     seconds after applying, 0-${MAX_TIME_SEC} (thumbnail: one value, default 1)`,
  "  --tile 256x320          tile size in pixels",
  "  --views front,three-quarter,face",
  "  --expression <name>     hold a VRM expression at full weight",
  "  --with-clip <path|library:[reaction/]...>  play a Gesture or Reaction clip at the",
  "                          same times; its effect events play as in chat, and a",
  "                          clip with effects can be rendered without sources",
  "  --together              apply every source at once on one sheet (<a+b+c>.png)",
  "  --local-content <dir>   content root for library:local/... (e.g. content/local)",
  "  --size 512              thumbnail edge in pixels (256-2048), Annie only",
  "  --rendering enhanced    Avatar rendering: enhanced (the app default) or classic",
  "  --materials automatic   the Avatar's material setting: automatic, liltoon or",
  "                          simple (a lilToon Avatar's fallback materials)",
  "  --avatar-file <a.vrm>   render on this VRM instead of the Included Avatars,",
  "                          such as a converted Avatar kept outside the repository",
  "",
  "The run exits 1 when an effect leaves a controller warning or no active effect,",
  "or when an Avatar Effect's art draws nothing visible where it belongs or draws",
  "mostly outside the head (compared with the same tiles without its art).",
  `Diff: a pixel differs when a channel differs by more than --threshold (default`,
  `${DEFAULT_THRESHOLD}/255); identical inputs and revisions should report 0 differing pixels.`,
].join("\n");

const VALUE_OPTIONS = new Set([
  "--out",
  "--times",
  "--tile",
  "--views",
  "--expression",
  "--with-clip",
  "--local-content",
  "--thumbnail",
  "--size",
  "--threshold",
  "--rendering",
  "--materials",
  "--avatar-file",
]);
const FLAG_OPTIONS = new Set([
  "--all-included",
  "--diff",
  "--help",
  "--together",
]);

/** Split argv into positional inputs, value options and flags. */
export function parseArgs(argv) {
  const positional = [];
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (FLAG_OPTIONS.has(arg)) {
      flags.add(arg);
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new EffectSourceError(`${arg} needs a value.`);
      values[arg] = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new EffectSourceError(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, flags };
}

/** Parse `--times`: comma-separated seconds in [0, MAX_TIME_SEC], ascending. */
export function parseTimes(value, fallback) {
  if (value === undefined) return fallback;
  const entries = value.split(",").map((entry) => entry.trim());
  const times = entries.map(Number);
  if (
    entries.some((entry) => entry === "") ||
    times.some((t) => !Number.isFinite(t) || t < 0 || t > MAX_TIME_SEC)
  )
    throw new EffectSourceError(
      `Invalid --times ${value}; use comma-separated seconds from 0 to ${MAX_TIME_SEC}.`,
    );
  // Frames only advance, so rows are rendered in ascending time.
  return [...new Set(times)].sort((a, b) => a - b);
}

function parseViews(value) {
  if (value === undefined) return VIEW_NAMES;
  const views = value
    .split(",")
    .map((view) => VIEW_ALIASES[view.trim()] ?? view.trim());
  if (!views.length || views.some((view) => !VIEW_NAMES.includes(view)))
    throw new EffectSourceError(
      `Invalid --views ${value}; use ${VIEW_NAMES.join(", ")}.`,
    );
  return views;
}

function parseTile(value) {
  if (value === undefined) return DEFAULT_TILE;
  const match = /^([1-9]\d{1,3})x([1-9]\d{1,3})$/.exec(value);
  if (!match) throw new EffectSourceError(`Invalid --tile ${value}.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Resolve `--avatar-file` (see `avatar-file.mjs`) as a usage error. */
async function resolveReviewAvatarFile(file) {
  try {
    return await resolveAvatarFile(file);
  } catch (error) {
    throw new EffectSourceError(error.message);
  }
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const { positional, values, flags } = parsed;
  if (flags.has("--help") || argv.length === 0) {
    console.log(USAGE);
    return flags.has("--help") ? 0 : 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const resolveOut = (value) => path.resolve(cwd, value);

  try {
    if (flags.has("--diff")) {
      if (positional.length !== 2)
        throw new EffectSourceError("--diff compares exactly two images.");
      const threshold =
        values["--threshold"] === undefined
          ? undefined
          : Number(values["--threshold"]);
      if (
        threshold !== undefined &&
        !(Number.isInteger(threshold) && threshold >= 0 && threshold <= 255)
      )
        throw new EffectSourceError("--threshold must be an integer 0-255.");
      const outFile = values["--out"] && resolveOut(values["--out"]);
      const result = await diffImages(
        path.resolve(cwd, positional[0]),
        path.resolve(cwd, positional[1]),
        { outFile, threshold },
      );
      console.log(
        `${result.width}×${result.height}: ${(result.differingShare * 100).toFixed(4)}% differing pixels (${result.differingPixels}), max channel delta ${result.maxChannelDelta}, threshold ${result.threshold}.`,
      );
      if (outFile) console.log(`Wrote ${outFile}`);
      return 0;
    }

    const localContent = values["--local-content"]
      ? await realpath(path.resolve(cwd, values["--local-content"]))
      : null;
    const sourceOptions = { cwd, localContent };
    const expression = values["--expression"] ?? null;
    const clipSource = values["--with-clip"]
      ? await resolveClipSource(values["--with-clip"], sourceOptions)
      : null;
    const clip = clipSource?.clip ?? null;
    const rendering = values["--rendering"] ?? "enhanced";
    if (!AVATAR_RENDERINGS.includes(rendering))
      throw new EffectSourceError(
        `Invalid --rendering ${rendering}; use ${AVATAR_RENDERINGS.join(" or ")}.`,
      );
    const materials = values["--materials"] ?? "automatic";
    if (!AVATAR_MATERIAL_MODES.includes(materials))
      throw new EffectSourceError(
        `Invalid --materials ${materials}; use ${AVATAR_MATERIAL_MODES.join(", ")}.`,
      );
    const avatarFile = values["--avatar-file"]
      ? await resolveReviewAvatarFile(
          path.resolve(cwd, values["--avatar-file"]),
        )
      : null;
    if (avatarFile && values["--thumbnail"])
      throw new EffectSourceError(
        "--avatar-file is for review sheets; thumbnails always use Annie.",
      );
    if (values["--materials"] && values["--thumbnail"])
      throw new EffectSourceError(
        "--materials is for review sheets; thumbnails always use Annie, who has no lilToon materials.",
      );

    if (values["--thumbnail"]) {
      if (positional.length !== 1 || flags.has("--all-included"))
        throw new EffectSourceError("--thumbnail renders exactly one source.");
      const times = parseTimes(values["--times"], [1]);
      const size = Number(values["--size"] ?? 512);
      if (times.length !== 1)
        throw new EffectSourceError("--thumbnail takes one --times value.");
      if (!Number.isInteger(size) || size < 256 || size > 2048)
        throw new EffectSourceError("--size must be an integer 256-2048.");
      const outFile = resolveOut(values["--thumbnail"]);
      await renderEffectThumbnail({
        effect: await resolveEffectSource(positional[0], sourceOptions),
        outFile,
        time: times[0],
        size,
        expression,
        clip,
        localContent,
        rendering,
      });
      console.log(`Wrote ${outFile}`);
      return 0;
    }

    if (!values["--out"]) throw new EffectSourceError("--out is required.");
    const effects = [
      ...(flags.has("--all-included")
        ? (await listIncludedEffects()).map((effect) => ({
            kind: "avatar",
            ...effect,
          }))
        : []),
    ];
    for (const spec of positional)
      effects.push(await resolveAnyEffectSource(spec, sourceOptions));
    const clipMedia = clipSource?.dependencies.length
      ? await resolveDependencies(clipSource.dependencies, { localContent })
      : null;
    for (const notice of clipMedia?.notices ?? [])
      console.log(`Warning: ${notice}`);
    const effectEvents = (clip?.events ?? []).filter((event) =>
      ["avatar_vfx", "particle_vfx", "scene_vfx"].includes(event?.kind),
    );
    if (effectEvents.length && !clipMedia)
      console.log(
        "Warning: the clip's effect events are not played: a clip file has no dependencies; render the Library item or its folder.",
      );
    if (effects.length === 0 && !clipMedia)
      throw new EffectSourceError(
        "Name a source, --all-included, or a --with-clip Reaction or Gesture with effects.",
      );
    const out = resolveOut(values["--out"]);
    const together = flags.has("--together");
    // One sheet (or a clip-only sheet) may be written to a named .png file.
    const single = (together || effects.length <= 1) && out.endsWith(".png");
    if (!single && !together) {
      // One sheet per stem: a repeated stem would overwrite an earlier sheet.
      const stems = effects.map((effect) => effect.stem);
      const repeated = stems.find(
        (stem, index) => stems.indexOf(stem) !== index,
      );
      if (repeated)
        throw new EffectSourceError(
          `Two sources share the stem "${repeated}"; render them separately or give each its own --out file.`,
        );
    }
    await renderEffectSheets({
      effects,
      together,
      clipMedia,
      clipStem:
        typeof clip?.id === "string"
          ? clip.id
          : path.basename(clipSource?.clipPath ?? "clip", ".json"),
      outFileFor: (effect) =>
        single ? out : path.join(out, `${effect.stem}.png`),
      times: parseTimes(values["--times"], DEFAULT_TIMES),
      tile: parseTile(values["--tile"]),
      views: parseViews(values["--views"]),
      expression,
      clip,
      localContent,
      rendering,
      materials,
      avatarFile,
      onResult: (result) => {
        console.log(
          result.failures.length
            ? `FAILED ${result.stem}: ${result.failures.join("; ")}`
            : `Wrote ${result.outFile}`,
        );
        for (const note of result.notes ?? [])
          console.log(`Note: ${result.stem}: ${note}`);
        const missing = new Set(
          result.avatars?.flatMap((avatar) => avatar.missingPoseRefs) ?? [],
        );
        if (missing.size)
          console.log(
            `Warning: clip poses not in the app catalog rendered as the base pose: ${[...missing].join(", ")}`,
          );
      },
    });
    return 0;
  } catch (error) {
    if (error instanceof EffectSourceError) {
      console.log(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof EffectRenderFailure) {
      const failed = error.results.filter((result) => result.failures.length);
      // Sheet failures were already printed per effect as they finished.
      if (values["--thumbnail"]) console.log(`FAILED ${error.message}`);
      console.log(
        `${failed.length} of ${error.results.length} effect render(s) failed.`,
      );
      return 1;
    }
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
