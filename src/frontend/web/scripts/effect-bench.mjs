import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVATARS,
  AVATAR_RENDERINGS,
  avatarFileUrl,
  pageClipMedia,
  pageEffect,
  sourceRoots,
  withRendererPage,
} from "./effect-render.mjs";
import {
  EffectSourceError,
  resolveClipSource,
  resolveDependencies,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

/**
 * Frame-cost benchmark for Avatar Effects on the GPU.
 *
 *   pnpm -s effects:bench [--frames 600] [--warmup 120] [--rounds 2] [--headed] [--json out.json]
 *
 * For each Included Avatar it plays a looping Gesture through
 * `Avatar.update` on a chat-equivalent canvas (DPR 2, antialiasing, the chat's
 * tone mapping and lights, enhanced unless `--rendering classic`) and
 * times `avatar.update` + `render` on the CPU and the render on the GPU
 * (`EXT_disjoint_timer_query_webgl2`) with no effects and with the heavy
 * combination: an animated face-surface effect, an animated eye hover, a body
 * effect and a silhouette overlay. The two alternate over `--rounds` passes so
 * drift does not favour either. The budget is a mean added frame time of at
 * most 2 ms.
 *
 * With `--reaction <spec>` it measures one Reaction's Avatar, Particle and
 * Scene Effects instead: the Reaction replays with and without its effect
 * events, the Scene layers draw around the canvas as in chat, and the frame
 * rate is uncapped so the interval between frames includes the DOM layers'
 * style, layout and compositing. The budget is a mean added frame interval
 * (and GPU time) of at most 4 ms.
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
/** Added frame time allowed for a Reaction's Particle and Scene Effects. */
export const REACTION_BUDGET_MS = 4;
/** Frame-rate flags for Reaction mode: rAF intervals then measure real work. */
const UNCAPPED_ARGS = ["--disable-frame-rate-limit", "--disable-gpu-vsync"];
const GPU_ARGS = [
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
];
const VIEWPORT = { width: 800, height: 600 };
/** The chat's typical Retina density, for the canvas and the DOM Scene layers. */
const DEVICE_SCALE = 2;

const USAGE = [
  "Usage: pnpm -s effects:bench [options]",
  "",
  "  --frames 600        measured frames per run (after warm-up)",
  "  --warmup 120        frames before each measured pass",
  "  --rounds 2          alternating no-effects/heavy passes (frames are split across them)",
  `  --clip <path|library:...>  looping Gesture (default ${DEFAULT_CLIP})`,
  `  --effects a,b       face effect sources (default ${DEFAULT_FACE_EFFECTS.join(",")})`,
  "  --reaction <path|library:reaction/...>  measure that Reaction's effects instead",
  "  --replay 90         Reaction mode: frames between replays of the Reaction",
  "  --local-content <dir>  content root for library:local/... sources",
  "  --headed            skip the headless attempt",
  "  --rendering enhanced  Avatar rendering: enhanced (the app default) or classic",
  "  --json <file>       also write the results as JSON",
].join("\n");

function isSoftwareRenderer(info) {
  return /swiftshader|llvmpipe|software/i.test(info.renderer);
}

/** Launch options to try, in order: headless with GPU flags, then headed. */
function launchCandidates(headed, extraArgs = []) {
  const args = [...GPU_ARGS, ...extraArgs];
  const headedLaunch = {
    headless: false,
    args: [...args, `--window-size=${VIEWPORT.width},${VIEWPORT.height + 80}`],
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
  };
  if (headed) return [headedLaunch];
  return [
    {
      headless: true,
      args,
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
    },
    headedLaunch,
  ];
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
  rendering = "enhanced",
  sourceOptions = {},
  log = console.log,
} = {}) {
  const clip = (await resolveClipSource(clipSpec, sourceOptions)).clip;
  const effects = [];
  for (const spec of effectSpecs)
    effects.push(await resolveEffectSource(spec, sourceOptions));
  for (const launch of launchCandidates(headed)) {
    const mode = launch.headless ? "headless" : "headed";
    const outcome = await withRendererPage(
      {
        localContent: sourceOptions.localContent ?? null,
        pageDir: "effect-bench",
        launch,
        extraRoots: await sourceRoots(effects),
        rendering,
      },
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
              pixelRatio: DEVICE_SCALE,
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

/**
 * Measure one Reaction's effects on every Included Avatar, on the first
 * launch whose WebGL renderer is a GPU.
 */
export async function runReactionBench({
  reactionSpec,
  frames = 600,
  warmupFrames = 120,
  rounds = 2,
  replayFrames = 90,
  headed = false,
  rendering = "enhanced",
  sourceOptions = {},
  log = console.log,
}) {
  const reaction = await resolveClipSource(reactionSpec, sourceOptions);
  const media = await resolveDependencies(reaction.dependencies, {
    localContent: sourceOptions.localContent ?? null,
  });
  for (const notice of media.notices) log(`Warning: ${notice}`);
  for (const launch of launchCandidates(headed, UNCAPPED_ARGS)) {
    const mode = launch.headless ? "headless" : "headed";
    const outcome = await withRendererPage(
      {
        localContent: sourceOptions.localContent ?? null,
        pageDir: "effect-bench",
        launch,
        extraRoots: await sourceRoots([], media),
        rendering,
      },
      async ({ page, fsUrl, imageUrl }) => {
        const info = await page.evaluate(() =>
          window.effectBenchRendererInfo(),
        );
        log(`${mode}: WebGL renderer ${info.renderer}`);
        if (isSoftwareRenderer(info)) return null;
        const clipMedia = await pageClipMedia(media, { fsUrl, imageUrl });
        const results = [];
        for (const id of AVATARS)
          results.push(
            await page.evaluate((request) => window.runReactionBench(request), {
              avatar: { id, url: avatarFileUrl(fsUrl, id) },
              clip: reaction.clip,
              clipMedia,
              width: VIEWPORT.width,
              height: VIEWPORT.height,
              pixelRatio: DEVICE_SCALE,
              warmupFrames,
              frames,
              rounds,
              replayFrames,
            }),
          );
        return { mode, info, results };
      },
    );
    if (outcome) return outcome;
  }
  throw new Error(
    "No GPU WebGL renderer was available headless or headed; software timings are not representative.",
  );
}

/** Print a Reaction-mode outcome; returns whether it is over budget. */
function reportReaction(outcome, rounds) {
  let overBudget = false;
  for (const result of outcome.results) {
    const added = (key) =>
      result.effects[key] && result.plain[key]
        ? result.effects[key].mean - result.plain[key].mean
        : null;
    const interval = added("interval");
    const cpu = added("cpu");
    const gpu = added("gpu");
    overBudget ||=
      interval > REACTION_BUDGET_MS || (gpu ?? 0) > REACTION_BUDGET_MS;
    console.log(
      [
        `${result.avatar} (${result.drawingBuffer.width}×${result.drawingBuffer.height}, ${result.plain.cpu.samples} frames per scenario in ${rounds} alternating rounds)`,
        `  without effects: frame ${format(result.plain.interval)}; CPU ${format(result.plain.cpu)}; GPU ${format(result.plain.gpu)}`,
        `  with effects:    frame ${format(result.effects.interval)}; CPU ${format(result.effects.cpu)}; GPU ${format(result.effects.gpu)}`,
        `  added mean: frame ${interval.toFixed(2)} ms; CPU ${cpu.toFixed(2)} ms; GPU ${gpu === null ? "n/a" : `${gpu.toFixed(2)} ms`} (budget ${REACTION_BUDGET_MS} ms)`,
        `  active: ${result.activeEffectIds.join(", ")}`,
        ...result.warnings.map((warning) => `  warning: ${warning}`),
      ].join("\n"),
    );
  }
  return overBudget;
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
        "--reaction",
        "--replay",
        "--local-content",
        "--json",
        "--rendering",
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
  const rendering = values["--rendering"] ?? "enhanced";
  if (!AVATAR_RENDERINGS.includes(rendering)) {
    console.log(
      `--rendering takes ${AVATAR_RENDERINGS.join(" or ")}.\n\n${USAGE}`,
    );
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const sourceOptions = {
      cwd,
      localContent: values["--local-content"]
        ? await realpath(path.resolve(cwd, values["--local-content"]))
        : null,
    };
    if (values["--reaction"]) {
      const replayFrames = Number(values["--replay"] ?? 90);
      if (!Number.isInteger(replayFrames) || replayFrames < 1) {
        console.log(`--replay takes a whole number of frames.\n\n${USAGE}`);
        return 2;
      }
      const outcome = await runReactionBench({
        reactionSpec: values["--reaction"],
        frames,
        warmupFrames,
        rounds,
        replayFrames,
        headed: flags.has("--headed"),
        rendering,
        sourceOptions,
      });
      console.log(`Mode: ${outcome.mode}; renderer: ${outcome.info.renderer}`);
      const overBudget = reportReaction(outcome, rounds);
      if (values["--json"]) {
        const file = path.resolve(cwd, values["--json"]);
        await writeFile(file, JSON.stringify(outcome, null, 2));
        console.log(`Wrote ${file}`);
      }
      if (overBudget) console.log(`Over the ${REACTION_BUDGET_MS} ms budget.`);
      return 0;
    }
    const outcome = await runEffectBench({
      frames,
      warmupFrames,
      rounds,
      clipSpec: values["--clip"] ?? DEFAULT_CLIP,
      effectSpecs: values["--effects"]?.split(",") ?? DEFAULT_FACE_EFFECTS,
      headed: flags.has("--headed"),
      rendering,
      sourceOptions,
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
