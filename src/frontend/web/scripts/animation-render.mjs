import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

/**
 * Render review contact sheets for a Gesture clip on both Included Avatars.
 *
 *   pnpm -s animation:render <clip.json> --out <dir> [--times 0,0.5,1]
 *     [--rows 8] [--side right|left] [--tile 220x330]
 *
 * Writes `<clip id>.png`: one row per time; per Avatar a front view, a ¾ and a
 * side view from the Avatar's own `--side` (default right), and a face
 * close-up. Output goes to the chosen directory, never the repository.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const avatarDir = path.join(repoRoot, "content/included/avatars");
const AVATARS = ["Andrew", "AvatarSample_A_1_New"];

export async function renderGestureSheet({
  clip,
  times,
  outFile,
  tile,
  side = "right",
  view = "body",
}) {
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-animation-render"),
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
      entries: [path.join(webRoot, "scripts/animation-render/render.ts")],
    },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [webRoot, avatarDir] } },
  });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage();
    const errors = [];
    // Any page error (including a failed module import) ends the wait early.
    const pageError = new Promise((_, reject) =>
      page.on("pageerror", (error) => {
        errors.push(error.message);
        reject(error);
      }),
    );
    pageError.catch(() => undefined);
    await page.goto(`${origin}/scripts/animation-render/index.html`);
    await Promise.race([
      page.waitForFunction(() => window.gestureRendererReady === true, null, {
        timeout: 60_000,
      }),
      pageError,
    ]);
    const result = await page.evaluate(
      (request) => window.renderGestureSheet(request),
      {
        clip,
        times,
        side,
        view,
        tile: tile ?? { width: 220, height: 330 },
        avatars: AVATARS.map((id) => ({
          id,
          url: `${origin}/@fs${path.join(avatarDir, `${id}.vrm`)}`,
        })),
      },
    );
    if (errors.length) throw new Error(errors.join("\n"));
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(
      outFile,
      Buffer.from(result.dataUrl.split(",")[1], "base64"),
    );
    return { outFile, missingPoseRefs: result.missingPoseRefs };
  } finally {
    await browser?.close();
    await server.close();
  }
}

/** Evenly spaced times across the clip, always including both ends. */
export function defaultTimes(duration, rows = 8) {
  return Array.from(
    { length: rows },
    (_, index) => Math.round(((duration * index) / (rows - 1)) * 1000) / 1000,
  );
}

const USAGE = [
  "Usage: pnpm -s animation:render <clip.json> --out <dir> [--times 0,0.5,1] [--rows 8] [--side right|left] [--view body|hands] [--tile 220x330]",
  "Renders one row per time: per Avatar a front view (its right hand on the viewer's left),",
  "a 3/4 and a side view from the Avatar's own --side, and a face close-up. --view hands",
  "instead shows close-ups of the --side hand from the front, 3/4, below and facing the palm",
  "(written as <id>.<side>-hand.png). Each tile is --tile pixels (larger tiles help judge",
  "small motions); the sheet adds a 64 px label column and a 28 px header.",
].join("\n");

const OPTIONS = new Set([
  "--out",
  "--times",
  "--rows",
  "--side",
  "--view",
  "--tile",
]);

async function main(argv) {
  const [input, ...rest] = argv;
  if (!input || input === "--help") {
    console.log(USAGE);
    return input ? 0 : 2;
  }
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!OPTIONS.has(name) || value === undefined || value.startsWith("--")) {
      console.log(`Invalid option ${name}.\n\n${USAGE}`);
      return 2;
    }
    values[name] = value;
  }
  const side = values["--side"] ?? "right";
  const view = values["--view"] ?? "body";
  const rows = Number(values["--rows"] ?? 8);
  const times = values["--times"]?.split(",").map(Number);
  const tileMatch = /^([1-9]\d{1,3})x([1-9]\d{1,3})$/.exec(
    values["--tile"] ?? "220x330",
  );
  if (
    !values["--out"] ||
    !["left", "right"].includes(side) ||
    !["body", "hands"].includes(view) ||
    !tileMatch ||
    (times &&
      (times.length === 0 ||
        times.some((t) => !Number.isFinite(t) || t < 0))) ||
    (!times && (!Number.isInteger(rows) || rows < 2))
  ) {
    console.log(USAGE);
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const clip = JSON.parse(await readFile(path.resolve(cwd, input), "utf8"));
  const duration = clip.duration ?? 0;
  const outFile = path.resolve(
    cwd,
    values["--out"],
    `${clip.id ?? "gesture"}${view === "hands" ? `.${side}-hand` : ""}.png`,
  );
  const result = await renderGestureSheet({
    clip,
    times: times ?? defaultTimes(duration, rows),
    outFile,
    side,
    view,
    tile: { width: Number(tileMatch[1]), height: Number(tileMatch[2]) },
  });
  console.log(`Wrote ${outFile}`);
  if (result.missingPoseRefs.length)
    console.log(
      `Warning: poses not in the app catalog rendered as the base pose: ${result.missingPoseRefs.join(", ")}`,
    );
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
