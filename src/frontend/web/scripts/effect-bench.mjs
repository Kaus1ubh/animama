import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVATARS,
  avatarFileUrl,
  pageEffect,
  withRendererPage,
} from "./effect-render.mjs";
import {
  EffectSourceError,
  resolveClipSource,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

/**
 * Frame-cost benchmark for Avatar Effects on the GPU.
 *
 *   pnpm -s effects:bench [--frames 600] [--warmup 120] [--rounds 2] [--headed] [--json out.json]
 *
 * For each Included Avatar it plays a looping Gesture through
 * `Avatar.update` on a chat-equivalent canvas (DPR 2, antialiasing, ACES) and
 * times `avatar.update` + `render` on the CPU and the render on the GPU
 * (`EXT_disjoint_timer_query_webgl2`) with no effects and with the heavy
 * combination: an animated face-surface effect, an animated eye hover, a body
 * effect and a silhouette overlay. The two alternate over `--rounds` passes so
 * drift does not favour either. The budget is a mean added frame time of at
 * most 2 ms.
 *
 * Chromium runs headless with Metal/GPU flags; when the WebGL renderer is a
 * software one (SwiftShader), or with `--headed`, it runs in a small headed
 * window instead. Timings come from real GPU frames only: the run refuses a
 * software renderer, whose numbers are not representative.
 */

const DEFAULT_FACE_EFFECTS = [
  "library:texture_sick_1",
  "library:eye_confused_swirl",
];
const DEFAULT_CLIP = "library:shy-finger-poke-loop";
export const BUDGET_MS = 2;
const GPU_ARGS = [
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
];
const VIEWPORT = { width: 800, height: 600 };

const USAGE = [
  "Usage: pnpm -s effects:bench [options]",
  "",
  "  --frames 600        measured frames per run (after warm-up)",
  "  --warmup 120        frames before each measured pass",
  "  --rounds 2          alternating no-effects/heavy passes (frames are split across them)",
  `  --clip <path|library:...>  looping Gesture (default ${DEFAULT_CLIP})`,
  `  --effects a,b       face effect sources (default ${DEFAULT_FACE_EFFECTS.join(",")})`,
  "  --headed            skip the headless attempt",
  "  --json <file>       also write the results as JSON",
].join("\n");

function isSoftwareRenderer(info) {
  return /swiftshader|llvmpipe|software/i.test(info.renderer);
}

/** Launch options to try, in order: headless with GPU flags, then headed. */
function launchCandidates(headed) {
  const headedLaunch = {
    headless: false,
    args: [
      ...GPU_ARGS,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height + 80}`,
    ],
    viewport: VIEWPORT,
  };
  if (headed) return [headedLaunch];
  return [{ headless: true, args: GPU_ARGS, viewport: VIEWPORT }, headedLaunch];
}

function format(stats) {
  return stats
    ? `${stats.mean.toFixed(2)} ms mean, ${stats.p95.toFixed(2)} ms p95`
    : "n/a";
}

/** Run every Avatar on the first launch whose WebGL renderer is a GPU. */
export async function runEffectBench({
  frames = 600,
  warmupFrames = 120,
  rounds = 2,
  clipSpec = DEFAULT_CLIP,
  effectSpecs = DEFAULT_FACE_EFFECTS,
  headed = false,
  log = console.log,
} = {}) {
  const clip = (await resolveClipSource(clipSpec)).clip;
  const effects = [];
  for (const spec of effectSpecs) effects.push(await resolveEffectSource(spec));
  for (const launch of launchCandidates(headed)) {
    const mode = launch.headless ? "headless" : "headed";
    const outcome = await withRendererPage(
      { localContent: null, pageDir: "effect-bench", launch },
      async ({ page, fsUrl, imageUrl }) => {
        const info = await page.evaluate(() =>
          window.effectBenchRendererInfo(),
        );
        log(`${mode}: WebGL renderer ${info.renderer}`);
        if (isSoftwareRenderer(info)) return null;
        const pageEffects = [];
        for (const effect of effects)
          pageEffects.push(await pageEffect(effect, imageUrl));
        const results = [];
        for (const id of AVATARS) {
          results.push(
            await page.evaluate((request) => window.runEffectBench(request), {
              avatar: { id, url: avatarFileUrl(fsUrl, id) },
              clip,
              effects: pageEffects,
              width: VIEWPORT.width,
              height: VIEWPORT.height,
              pixelRatio: 2,
              warmupFrames,
              frames,
              rounds,
            }),
          );
        }
        return { mode, info, results };
      },
    );
    if (outcome) return outcome;
  }
  throw new Error(
    "No GPU WebGL renderer was available headless or headed; software timings are not representative.",
  );
}

async function main(argv) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headed" || arg === "--help") flags.add(arg);
    else if (
      [
        "--frames",
        "--warmup",
        "--rounds",
        "--clip",
        "--effects",
        "--json",
      ].includes(arg)
    ) {
      values[arg] = argv[++index];
    } else {
      console.log(`Unknown argument ${arg}.\n\n${USAGE}`);
      return 2;
    }
  }
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  const frames = Number(values["--frames"] ?? 600);
  const warmupFrames = Number(values["--warmup"] ?? 120);
  const rounds = Number(values["--rounds"] ?? 2);
  if (
    rounds < 1 ||
    ![frames, warmupFrames, rounds].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 100_000,
    ) ||
    frames < 1
  ) {
    console.log(
      `--frames, --warmup and --rounds take whole counts.\n\n${USAGE}`,
    );
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const outcome = await runEffectBench({
      frames,
      warmupFrames,
      rounds,
      clipSpec: values["--clip"] ?? DEFAULT_CLIP,
      effectSpecs: values["--effects"]?.split(",") ?? DEFAULT_FACE_EFFECTS,
      headed: flags.has("--headed"),
    });
    console.log(`Mode: ${outcome.mode}; renderer: ${outcome.info.renderer}`);
    let overBudget = false;
    for (const result of outcome.results) {
      const added = result.heavy.cpu.mean - result.none.cpu.mean;
      const addedGpu =
        result.heavy.gpu && result.none.gpu
          ? result.heavy.gpu.mean - result.none.gpu.mean
          : null;
      overBudget ||= added > BUDGET_MS || (addedGpu ?? 0) > BUDGET_MS;
      console.log(
        [
          `${result.avatar} (${result.drawingBuffer.width}×${result.drawingBuffer.height}, ${result.none.cpu.samples} frames per scenario in ${rounds} alternating rounds; ${result.none.disjointFrames + result.heavy.disjointFrames} GPU samples voided by disjoint events)`,
          `  no effects: CPU ${format(result.none.cpu)}; GPU ${format(result.none.gpu)}; ${result.none.drawCalls} draw calls`,
          `  heavy:      CPU ${format(result.heavy.cpu)}; GPU ${format(result.heavy.gpu)}; ${result.heavy.drawCalls} draw calls`,
          `  added mean: CPU ${added.toFixed(2)} ms; GPU ${addedGpu === null ? "n/a" : `${addedGpu.toFixed(2)} ms`} (budget ${BUDGET_MS} ms)`,
          `  active: ${result.activeEffectIds.join(", ")}`,
          ...result.warnings.map((warning) => `  warning: ${warning}`),
        ].join("\n"),
      );
    }
    if (values["--json"]) {
      const file = path.resolve(cwd, values["--json"]);
      await writeFile(file, JSON.stringify(outcome, null, 2));
      console.log(`Wrote ${file}`);
    }
    if (overBudget) console.log(`Over the ${BUDGET_MS} ms budget.`);
    return 0;
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
  process.exit(await main(process.argv.slice(2)));
}
