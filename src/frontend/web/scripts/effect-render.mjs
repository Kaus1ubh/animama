import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

import {
  EffectSourceError,
  INCLUDED_EFFECT_ROOT,
  REPO_ROOT,
  isInside,
  listIncludedEffects,
  resolveClipSource,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

/**
 * Headless review renders for Avatar Effects on both Included Avatars.
 *
 *   pnpm -s effects:render <source...>|--all-included --out <file.png|dir>
 *   pnpm -s effects:render <source> --thumbnail <out.webp>
 *   pnpm -s effects:render --diff <a.png> <b.png> [--out diff.png]
 *
 * A source is an effect folder, a descriptor `.json`, or
 * `library:[included/|local/]<stem|content_id|name>`. The page mounts real
 * `Avatar`s and applies the effect through the runtime path; see
 * `effect-render/render.ts`. A run fails when an apply leaves a controller
 * warning or no active effect, because apply calls never throw.
 *
 * Diff tolerance: a pixel differs when any RGBA channel differs by more than
 * `--threshold` (default 8 of 255), which absorbs antialiasing and float
 * rounding noise. Renders of the same source and revision are expected to
 * report 0 differing pixels; investigate any non-zero share.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const avatarDir = path.join(REPO_ROOT, "content/included/avatars");
/** The Included Avatars every sheet and benchmark covers. */
export const AVATARS = ["AvatarSample_Y_0", "AvatarSample_A_1_New"];

/** The page URL of an Included Avatar's VRM. */
export const avatarFileUrl = (fsUrl, id) =>
  fsUrl(path.join(avatarDir, `${id}.vrm`));
/** Annie, the Library thumbnail Avatar. */
const THUMBNAIL_AVATAR = "AvatarSample_A_1_New";

export const DEFAULT_TIMES = [0.1, 0.5, 1, 2];
export const DEFAULT_TILE = { width: 256, height: 320 };
export const VIEW_NAMES = ["front", "three-quarter", "face"];
export const DEFAULT_THRESHOLD = 8;
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
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
};

/**
 * Start a page, run `callback({ page, fsUrl, imageUrl })`, and always shut
 * down. Vite serves only the web root, the Included Avatars, the Included
 * effects and an optional local content root; any other effect image is
 * inlined. `pageDir` names the page under `scripts/` (default the review
 * renderer); it must set `window.effectRendererReady`. `launch` holds the
 * Playwright Chromium launch options plus an optional page `viewport`.
 */
export async function withRendererPage(
  { localContent, pageDir = "effect-render", launch = SWIFTSHADER_LAUNCH },
  callback,
) {
  const allow = [webRoot, avatarDir, INCLUDED_EFFECT_ROOT];
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
    const { viewport, ...launchOptions } = launch;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage(viewport ? { viewport } : {});
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
    const result = await callback({ page, fsUrl, imageUrl });
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
  };
}

function decodeDataUrl(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/**
 * Render one contact sheet per effect: rows are `times` after applying,
 * columns are `views` for each Included Avatar. With `together`, all effects
 * are applied at once on a single sheet (stem `a+b+c`), to check that they
 * coexist. Every sheet is attempted and written even when it fails, then
 * `EffectRenderFailure` is thrown if any failed.
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
  localContent = null,
  onResult,
}) {
  const results = await withRendererPage(
    { localContent },
    async ({ page, fsUrl, imageUrl }) => {
      const avatars = AVATARS.map((id) => ({
        id,
        url: avatarFileUrl(fsUrl, id),
      }));
      const results = [];
      const groups = together ? [effects] : effects.map((effect) => [effect]);
      for (const group of groups) {
        const stem = group.map((effect) => effect.stem).join("+");
        const result = { stem, outFile: null, failures: [] };
        try {
          const pageEffects = [];
          for (const effect of group)
            pageEffects.push(await pageEffect(effect, imageUrl));
          const rendered = await page.evaluate(
            (request) => window.renderEffectSheet(request),
            {
              effects: pageEffects,
              avatars,
              times,
              tile,
              views,
              expression,
              clip,
            },
          );
          result.avatars = rendered.avatars;
          result.failures = rendered.avatars.flatMap((avatar) =>
            avatarFailures(avatar, group.length),
          );
          result.outFile = outFileFor(group.length === 1 ? group[0] : { stem });
          await mkdir(path.dirname(result.outFile), { recursive: true });
          await writeFile(result.outFile, decodeDataUrl(rendered.dataUrl));
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
  { effect, outFile, time, size, expression, clip },
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
}) {
  const result = await withRendererPage({ localContent }, (context) =>
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
 * for the whole batch). `jobs` are `{ effect, outFile }`. Every job is
 * attempted; `EffectRenderFailure` is thrown afterwards if any failed.
 */
export async function renderEffectThumbnails({
  jobs,
  time = 1,
  size = 512,
  onResult,
}) {
  const results = await withRendererPage({}, async (context) => {
    const results = [];
    for (const { effect, outFile } of jobs) {
      let result;
      try {
        result = await writeThumbnailOnPage(context, {
          effect,
          outFile,
          time,
          size,
          expression: null,
          clip: null,
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
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(
        delta,
        Math.abs(left.data[offset + channel] - right.data[offset + channel]),
      );
    }
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
  "A source is an effect folder, a descriptor .json, or",
  "library:[included/|local/]<stem|content_id|name>. Each sheet has one row per",
  "time after applying and, per Included Avatar, one tile per view. With several",
  "sources --out is a directory receiving <stem>.png.",
  "",
  "Options:",
  `  --times 0.1,0.5,1,2     seconds after applying, 0-${MAX_TIME_SEC} (thumbnail: one value, default 1)`,
  "  --tile 256x320          tile size in pixels",
  "  --views front,three-quarter,face",
  "  --expression <name>     hold a VRM expression at full weight",
  "  --with-clip <path|library:...>  sample an Anima Pose Clip Gesture at the same times",
  "  --together              apply every source at once on one sheet (<a+b+c>.png)",
  "  --local-content <dir>   content root for library:local/... (e.g. content/local)",
  "  --size 512              thumbnail edge in pixels (256-2048), Annie only",
  "",
  "The run exits 1 when an effect leaves a controller warning or no active effect.",
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
    const clip = values["--with-clip"]
      ? (await resolveClipSource(values["--with-clip"], sourceOptions)).clip
      : null;

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
      });
      console.log(`Wrote ${outFile}`);
      return 0;
    }

    if (!values["--out"]) throw new EffectSourceError("--out is required.");
    const effects = [
      ...(flags.has("--all-included") ? await listIncludedEffects() : []),
    ];
    for (const spec of positional)
      effects.push(await resolveEffectSource(spec, sourceOptions));
    if (effects.length === 0)
      throw new EffectSourceError("Name a source or --all-included.");
    const out = resolveOut(values["--out"]);
    const together = flags.has("--together");
    const single = (together || effects.length === 1) && out.endsWith(".png");
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
      outFileFor: (effect) =>
        single ? out : path.join(out, `${effect.stem}.png`),
      times: parseTimes(values["--times"], DEFAULT_TIMES),
      tile: parseTile(values["--tile"]),
      views: parseViews(values["--views"]),
      expression,
      clip,
      localContent,
      onResult: (result) => {
        console.log(
          result.failures.length
            ? `FAILED ${result.stem}: ${result.failures.join("; ")}`
            : `Wrote ${result.outFile}`,
        );
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
