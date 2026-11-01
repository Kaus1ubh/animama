import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAvatarFile } from "./avatar-file.mjs";
import {
  AVATARS,
  AVATAR_MATERIAL_MODES,
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
 *   pnpm -s effects:bench --avatar-file a.vrm --breakdown all [--materials simple] [--pixel-ratios 1,1.5,2]
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
 * `--materials` loads the Avatar with that material setting (Simple draws a
 * lilToon Avatar's glTF fallbacks); `--pixel-ratios` repeats each
 * measurement at other device pixel ratios, for how the cost scales with
 * resolution; and `--fps` paces frames like the app instead of using every
 * display frame. Pace GPU comparisons with `--fps 60`: unpaced headless runs
 * can reach 120 fps, where a heavy Avatar saturates the GPU and its timer
 * queries also count queued work.
 *
 * Paced GPU times follow the GPU's clock: a lightly loaded GPU runs slower, so
 * a lighter frame can take about as long and savings look smaller than they
 * are. `--saturate <n>` measures the work instead: each sample renders n
 * frames back to back and waits for the GPU with a 1-pixel readback
 * (`finish()` does not wait in Chromium), keeping the GPU at its top clock.
 * It reports wall time per frame in place of GPU time, and the submission
 * time per frame as CPU time; where the two are close the run is CPU-bound and
 * the GPU's share is hidden. `--fps` then only sets the animation step. Each
 * pass starts with idle gaps (400 ms before its warm-up, 150 ms before its
 * measured frames), so a GPU trace taken alongside (Instruments' Metal System
 * Trace on macOS) can be cut into passes.
 *
 * With `--breakdown <kinds>` it breaks the plain Avatar's frame cost down
 * instead (no effects): the baseline alternates with scenarios that each
 * change one thing, and each reports its GPU and CPU time, draw calls and
 * triangles from `renderer.info`, and the share of the Avatar's pixels that
 * change in a probe frame of the same pose:
 *
 *   materials  each glTF material hidden, and drawn alone;
 *   features   each lilToon feature switched off on every material using it
 *              (toon shadow, rim, matcaps, emission, normal maps, outline
 *              pass, two-pass pre-pass, blending, alpha test, …), then all
 *              but transparency together, then the runtime's depth
 *              pre-pass off and prototype drawing changes (blending off on
 *              opaque materials, morph targets dropped, morph weights from
 *              uniforms);
 *   layers     each structural layer hidden: the eye stack, irises, eye
 *              highlights, eye-bone eye whites, eye lines, eyelashes, face
 *              skin and hair as face-part detection finds them, the
 *              alpha-blended and alpha-tested primitives, and the rest;
 *   mixed      chosen materials drawn with their glTF fallbacks, borrowed
 *              from a second, Simple load of the file.
 *
 * `--apply <ids>` applies feature scenarios to every measurement, to time a
 * combination or break one down further. Materials are named by glTF index
 * and layers by structure, never by the file's material or mesh names; the
 * Avatar itself is labelled with its file name.
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
/** What `--breakdown` varies (`effect-bench/breakdown.ts`). */
export const BREAKDOWN_KINDS = ["materials", "features", "layers", "mixed"];
/** Highest `--pixel-ratios` value: twice the chat's own maximum. */
const MAX_PIXEL_RATIO = 4;
/** Highest `--fps` value. */
const MAX_FPS = 240;
/** Highest `--saturate` batch. */
const MAX_SATURATE = 100;

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
  "  --avatar-file <a.vrm>  measure this VRM instead of the Included Avatars",
  "  --materials automatic  the Avatar's material setting: automatic, liltoon or",
  "                      simple (a lilToon Avatar's fallback materials)",
  `  --pixel-ratios ${DEVICE_SCALE}    device pixel ratios to measure, comma-separated (e.g. 1,1.5,2)`,
  "  --fps <n>           render at most n frames per second, paced like the app",
  "                      (an idle chat renders at 30); every display frame by default",
  "  --saturate <n>      time batches of n frames rendered back to back, which keep",
  "                      the GPU at its top clock; reports wall time per frame",
  "  --breakdown <kinds> break the plain frame cost down instead of timing effects:",
  `                      comma-separated ${BREAKDOWN_KINDS.join(", ")}, or all`,
  "  --apply <ids>       apply feature scenarios (ids a features breakdown lists,",
  "                      e.g. outline,shadow,depth-prepass) to every measurement",
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

/** What GPU samples hold: timer queries, or saturated wall time per frame. */
function gpuLabel(result) {
  return result.saturate ? "frame (saturated)" : "GPU";
}

function format(stats) {
  return stats
    ? `${stats.mean.toFixed(2)} ms mean, ${stats.p95.toFixed(2)} ms p95`
    : "n/a";
}

/** The Avatars a run measures: `avatarFile`, or both Included Avatars. */
function benchAvatars(avatarFile, fsUrl) {
  return avatarFile
    ? [
        {
          id: path.basename(avatarFile).replace(/\.vrm$/i, ""),
          url: fsUrl(avatarFile),
        },
      ]
    : AVATARS.map((id) => ({ id, url: avatarFileUrl(fsUrl, id) }));
}

/**
 * Run every Avatar at every pixel ratio on the first launch whose WebGL
 * renderer is a GPU. With `breakdown` kinds, each run breaks the plain
 * Avatar's frame cost down instead of timing the effects.
 */
export async function runEffectBench({
  frames = 600,
  warmupFrames = 120,
  rounds = 2,
  clipSpec = DEFAULT_CLIP,
  effectSpecs = DEFAULT_FACE_EFFECTS,
  headed = false,
  rendering = "enhanced",
  materials = "automatic",
  pixelRatios = [DEVICE_SCALE],
  fps = null,
  saturate = null,
  apply = [],
  breakdown = null,
  avatarFile = null,
  sourceOptions = {},
  log = console.log,
} = {}) {
  const clip = (await resolveClipSource(clipSpec, sourceOptions)).clip;
  const effects = [];
  if (!breakdown)
    for (const spec of effectSpecs)
      effects.push(await resolveEffectSource(spec, sourceOptions));
  for (const launch of launchCandidates(headed)) {
    const mode = launch.headless ? "headless" : "headed";
    const outcome = await withRendererPage(
      {
        localContent: sourceOptions.localContent ?? null,
        pageDir: "effect-bench",
        launch,
        extraRoots: [
          ...(await sourceRoots(effects)),
          ...(avatarFile ? [avatarFile] : []),
        ],
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
        for (const avatar of benchAvatars(avatarFile, fsUrl)) {
          for (const pixelRatio of pixelRatios) {
            const request = {
              avatar,
              clip,
              width: VIEWPORT.width,
              height: VIEWPORT.height,
              pixelRatio,
              materialMode: materials,
              fps,
              saturate,
              apply,
              warmupFrames,
              frames,
              rounds,
            };
            results.push(
              breakdown
                ? await page.evaluate(
                    (value) => window.runEffectBenchBreakdown(value),
                    { ...request, breakdown },
                  )
                : await page.evaluate((value) => window.runEffectBench(value), {
                    ...request,
                    effects: pageEffects,
                  }),
            );
          }
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

/** "600 frames", or "60 samples of 10 back-to-back frames" when saturated. */
function sampleCount(result, scenario) {
  return result.saturate
    ? `${scenario.cpu.samples} samples of ${result.saturate} back-to-back frames`
    : `${scenario.cpu.samples} frames`;
}

/** A signed difference in milliseconds, for "added" columns. */
function signed(ms) {
  return `${ms >= 0 ? "+" : "−"}${Math.abs(ms).toFixed(2)}`;
}

/** Print the effects comparison; returns whether it is over budget. */
function reportEffects(outcome, rounds) {
  let overBudget = false;
  for (const result of outcome.results) {
    const added = result.heavy.cpu.mean - result.none.cpu.mean;
    const addedGpu =
      result.heavy.gpu && result.none.gpu
        ? result.heavy.gpu.mean - result.none.gpu.mean
        : null;
    overBudget ||= added > BUDGET_MS || (addedGpu ?? 0) > BUDGET_MS;
    const materials = [
      ...(result.materialMode === "automatic"
        ? []
        : [`, ${result.materialMode} materials`]),
      ...(result.applied.length ? [`, with ${result.applied.join(", ")}`] : []),
    ].join("");
    console.log(
      [
        `${result.avatar} (${result.drawingBuffer.width}×${result.drawingBuffer.height}${materials}, ${sampleCount(result, result.none)} per scenario in ${rounds} alternating rounds${result.saturate ? "" : `; ${result.none.disjointFrames + result.heavy.disjointFrames} GPU samples voided by disjoint events`})`,
        `  no effects: CPU ${format(result.none.cpu)}; ${gpuLabel(result)} ${format(result.none.gpu)}; ${result.none.drawCalls} draw calls`,
        `  heavy:      CPU ${format(result.heavy.cpu)}; ${gpuLabel(result)} ${format(result.heavy.gpu)}; ${result.heavy.drawCalls} draw calls`,
        `  added mean: CPU ${added.toFixed(2)} ms; ${gpuLabel(result)} ${addedGpu === null ? "n/a" : `${addedGpu.toFixed(2)} ms`} (budget ${BUDGET_MS} ms)`,
        `  active: ${result.activeEffectIds.join(", ")}`,
        ...result.warnings.map((warning) => `  warning: ${warning}`),
      ].join("\n"),
    );
  }
  return overBudget;
}

const BREAKDOWN_HEADINGS = {
  materials: "materials (hidden, or drawn alone):",
  features: "lilToon features (off on every material that uses them):",
  layers: "layers (hidden):",
  mixed: "lilToon on chosen materials (the rest drawn with glTF fallbacks):",
};

/** Print breakdown results: structure, baseline, then each scenario's cost. */
function reportBreakdown(outcome, rounds) {
  for (const result of outcome.results) {
    const { baseline, structure } = result;
    const voided = [baseline, ...result.scenarios].reduce(
      (total, scenario) => total + scenario.disjointFrames,
      0,
    );
    const lines = [
      `${result.avatar} breakdown at DPR ${result.pixelRatio} (${result.drawingBuffer.width}×${result.drawingBuffer.height}; materials ${result.materialMode}, lilToon ${result.lilToonMaterials}${result.applied.length ? `, with ${result.applied.join(", ")}` : ""}; ${sampleCount(result, baseline)} per scenario in ${rounds} alternating rounds${result.saturate ? "" : `; ${voided} GPU samples voided by disjoint events`})`,
      `  structure: ${structure.materials.length} materials, ${structure.primitives} primitives, ${structure.triangles} triangles; the Avatar covers ${result.avatarPixels} pixels`,
      ...structure.materials.map(
        (material) =>
          `    ${material.index === null ? "unassigned material" : `material #${material.index}`}: ${material.kind}, ${material.blendState}${material.prepassBlocker === null ? ", depth pre-pass" : material.kind.startsWith("lilToon") ? `, no depth pre-pass (${material.prepassBlocker})` : ""}; ${material.primitives} primitives, ${material.triangles} triangles, ${material.morphTargets} morph targets${material.features.length ? `; features ${material.features.join(", ")}` : ""}${material.parts.length ? `; holds ${material.parts.join(", ")}` : ""}`,
      ),
      `  baseline: ${gpuLabel(result)} ${format(baseline.gpu)}; CPU ${format(baseline.cpu)}; ${baseline.drawCalls} draw calls, ${baseline.triangles} triangles${result.saturate ? "" : `; ${baseline.frameRate.toFixed(1)} fps`}${baseline.gpu ? `${result.saturate ? "" : `, GPU busy ${((baseline.gpu.mean * baseline.frameRate) / 10).toFixed(0)}%`}; ${gpuLabel(result)} per pass ${baseline.passes.map((ms) => ms.toFixed(2)).join(", ")} ms` : ""}`,
    ];
    let group = null;
    for (const scenario of result.scenarios) {
      if (scenario.group !== group) {
        group = scenario.group;
        lines.push(`  ${BREAKDOWN_HEADINGS[group] ?? `${group}:`}`);
      }
      const gpu =
        scenario.gpu && baseline.gpu
          ? `${gpuLabel(result)} ${scenario.gpu.mean.toFixed(2)} ms (${signed(scenario.gpu.mean - baseline.gpu.mean)})`
          : `${gpuLabel(result)} n/a`;
      lines.push(
        `    ${scenario.label}: ${gpu}; CPU ${scenario.cpu.mean.toFixed(2)} ms; ${scenario.drawCalls} draw calls, ${scenario.triangles} triangles; ${(scenario.changedPixels * 100).toFixed(1)}% of the Avatar's pixels change`,
      );
    }
    lines.push(...result.notes.map((note) => `  note: ${note}`));
    console.log(lines.join("\n"));
  }
}

/** A comma-separated list option, trimmed, without empty entries. */
function listOf(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const VALUE_OPTIONS = [
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
  "--avatar-file",
  "--materials",
  "--pixel-ratios",
  "--fps",
  "--saturate",
  "--breakdown",
  "--apply",
];
/** Options that only the effects benchmark (and its breakdown) takes. */
const EFFECTS_ONLY_OPTIONS = [
  "--avatar-file",
  "--materials",
  "--pixel-ratios",
  "--fps",
  "--saturate",
  "--breakdown",
  "--apply",
];

/**
 * Parse and check the command line. Returns `{ help: true }`, `{ error }`
 * (a message for the usage text) or `{ options }`; paths stay unresolved.
 */
export function parseBenchArgs(argv) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headed" || arg === "--help") flags.add(arg);
    else if (VALUE_OPTIONS.includes(arg)) {
      if (index + 1 >= argv.length) return { error: `${arg} takes a value.` };
      values[arg] = argv[++index];
    } else return { error: `Unknown argument ${arg}.` };
  }
  if (flags.has("--help")) return { help: true };
  const frames = Number(values["--frames"] ?? 600);
  const warmupFrames = Number(values["--warmup"] ?? 120);
  const rounds = Number(values["--rounds"] ?? 2);
  if (
    rounds < 1 ||
    ![frames, warmupFrames, rounds].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 100_000,
    ) ||
    frames < 1
  )
    return { error: "--frames, --warmup and --rounds take whole counts." };
  const rendering = values["--rendering"] ?? "enhanced";
  if (!AVATAR_RENDERINGS.includes(rendering))
    return { error: `--rendering takes ${AVATAR_RENDERINGS.join(" or ")}.` };
  const materials = values["--materials"] ?? "automatic";
  if (!AVATAR_MATERIAL_MODES.includes(materials))
    return {
      error: `--materials takes ${AVATAR_MATERIAL_MODES.join(", ")}.`,
    };
  const pixelRatios = values["--pixel-ratios"]
    ? listOf(values["--pixel-ratios"]).map(Number)
    : [DEVICE_SCALE];
  if (
    pixelRatios.length === 0 ||
    !pixelRatios.every(
      (value) =>
        Number.isFinite(value) && value > 0 && value <= MAX_PIXEL_RATIO,
    )
  )
    return {
      error: `--pixel-ratios takes numbers above 0 and at most ${MAX_PIXEL_RATIO}, comma-separated.`,
    };
  const fps = values["--fps"] === undefined ? null : Number(values["--fps"]);
  if (fps !== null && !(Number.isFinite(fps) && fps >= 1 && fps <= MAX_FPS))
    return { error: `--fps takes a number from 1 to ${MAX_FPS}.` };
  const saturate =
    values["--saturate"] === undefined ? null : Number(values["--saturate"]);
  if (
    saturate !== null &&
    !(Number.isInteger(saturate) && saturate >= 1 && saturate <= MAX_SATURATE)
  )
    return {
      error: `--saturate takes a whole number of frames from 1 to ${MAX_SATURATE}.`,
    };
  let breakdown = null;
  if (values["--breakdown"] !== undefined) {
    const kinds = listOf(values["--breakdown"]);
    breakdown = kinds.includes("all")
      ? [...BREAKDOWN_KINDS]
      : BREAKDOWN_KINDS.filter((kind) => kinds.includes(kind));
    const unknown = kinds.filter(
      (kind) => kind !== "all" && !BREAKDOWN_KINDS.includes(kind),
    );
    if (unknown.length || breakdown.length === 0)
      return {
        error: `--breakdown takes ${BREAKDOWN_KINDS.join(", ")} or all, comma-separated.`,
      };
    if (values["--effects"] !== undefined)
      return {
        error:
          "--effects applies to the effects comparison; --breakdown measures the Avatar without effects.",
      };
  }
  if (values["--reaction"] !== undefined) {
    const misplaced = EFFECTS_ONLY_OPTIONS.find(
      (option) => values[option] !== undefined,
    );
    if (misplaced)
      return {
        error: `${misplaced} applies to the effects benchmark, not --reaction.`,
      };
    const replayFrames = Number(values["--replay"] ?? 90);
    if (!Number.isInteger(replayFrames) || replayFrames < 1)
      return { error: "--replay takes a whole number of frames." };
    return {
      options: {
        reactionSpec: values["--reaction"],
        frames,
        warmupFrames,
        rounds,
        replayFrames,
        headed: flags.has("--headed"),
        rendering,
        localContent: values["--local-content"] ?? null,
        json: values["--json"] ?? null,
      },
    };
  }
  return {
    options: {
      frames,
      warmupFrames,
      rounds,
      avatarFile: values["--avatar-file"] ?? null,
      clipSpec: values["--clip"] ?? DEFAULT_CLIP,
      effectSpecs: values["--effects"]
        ? listOf(values["--effects"])
        : DEFAULT_FACE_EFFECTS,
      headed: flags.has("--headed"),
      rendering,
      materials,
      pixelRatios,
      fps,
      saturate,
      apply: values["--apply"] ? listOf(values["--apply"]) : [],
      breakdown,
      localContent: values["--local-content"] ?? null,
      json: values["--json"] ?? null,
    },
  };
}

async function main(argv) {
  const parsed = parseBenchArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.log(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const { localContent, json, ...options } = parsed.options;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const sourceOptions = {
      cwd,
      localContent: localContent
        ? await realpath(path.resolve(cwd, localContent))
        : null,
    };
    const writeJson = async (outcome) => {
      if (!json) return;
      const file = path.resolve(cwd, json);
      await writeFile(file, JSON.stringify(outcome, null, 2));
      console.log(`Wrote ${file}`);
    };
    if (options.reactionSpec) {
      const outcome = await runReactionBench({ ...options, sourceOptions });
      console.log(`Mode: ${outcome.mode}; renderer: ${outcome.info.renderer}`);
      const overBudget = reportReaction(outcome, options.rounds);
      await writeJson(outcome);
      if (overBudget) console.log(`Over the ${REACTION_BUDGET_MS} ms budget.`);
      return 0;
    }
    const outcome = await runEffectBench({
      ...options,
      avatarFile: options.avatarFile
        ? await resolveAvatarFile(path.resolve(cwd, options.avatarFile))
        : null,
      sourceOptions,
    });
    console.log(`Mode: ${outcome.mode}; renderer: ${outcome.info.renderer}`);
    if (options.breakdown) {
      reportBreakdown(outcome, options.rounds);
      await writeJson(outcome);
      return 0;
    }
    const overBudget = reportEffects(outcome, options.rounds);
    await writeJson(outcome);
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
