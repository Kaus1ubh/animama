import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { loadWebModule } from "./effects.mjs";
import { optimizeVrm } from "./vrm-optimize/optimize.mjs";
import { compareVrm } from "./vrm-optimize/verify.mjs";

/**
 * Size optimization for VRM 1.0 Avatars that Animama ships:
 *
 *   pnpm -s vrm:optimize <source.vrm> --out <optimized.vrm> [--meta <meta.json>]
 *   pnpm -s vrm:optimize verify <source.vrm> <optimized.vrm> [--meta <meta.json>]
 *   pnpm -s vrm:optimize compare <source.vrm> <optimized.vrm> --out <dir> [--min-psnr 45]
 *
 * See docs/frontend/runtime/vrm-optimization.md for what it changes and why it
 * never prunes, merges, reorders or quantizes.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = [
  "Usage:",
  "  pnpm -s vrm:optimize <source.vrm> --out <optimized.vrm> [--meta <meta.json>]",
  "  pnpm -s vrm:optimize verify <source.vrm> <optimized.vrm> [--meta <meta.json>]",
  "  pnpm -s vrm:optimize compare <source.vrm> <optimized.vrm> --out <dir> [--min-psnr 45]",
].join("\n");

/** Options each command accepts; anything else is an error, not ignored. */
const OPTIONS = {
  optimize: ["out", "meta"],
  verify: ["meta"],
  compare: ["out", "min-psnr"],
};

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") help = true;
    else if (value.startsWith("--")) {
      if (argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
        throw new Error(`${value} needs a value.\n\n${USAGE}`);
      options[value.slice(2)] = argv[index + 1];
      index += 1;
    } else positional.push(value);
  }
  const command = ["verify", "compare"].includes(positional[0])
    ? positional[0]
    : "optimize";
  const unknown = Object.keys(options).filter(
    (name) => !OPTIONS[command].includes(name),
  );
  if (unknown.length)
    throw new Error(
      `Unknown option --${unknown[0]} for ${command}.\n\n${USAGE}`,
    );
  return { positional, options, help };
}

const readBytes = async (file) => new Uint8Array(await readFile(file));
const readMeta = async (file) =>
  file ? JSON.parse(await readFile(file, "utf8")) : undefined;

/**
 * What the app sees after loading: mesh and primitive order, morph names,
 * expressions, humanoid bones, spring joints and material names.
 */
async function loadedSummary(load, bytes) {
  const { vrm } = await load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    {
      removeUnnecessaryVertices: true,
    },
  );
  const meshes = [];
  vrm.scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    meshes.push({
      name: object.name,
      vertices: object.geometry.attributes.position.count,
      morphs: Object.keys(object.morphTargetDictionary ?? {}),
      materials: materials.map((material) => material.name),
    });
  });
  return {
    meshes,
    expressions:
      vrm.expressionManager?.expressions
        .map((expression) => expression.expressionName)
        .sort() ?? [],
    bones: Object.keys(vrm.humanoid.humanBones).sort(),
    springJoints: vrm.springBoneManager?.joints.size ?? 0,
  };
}

async function verify(sourceBytes, optimizedBytes, meta) {
  const differences = await compareVrm(sourceBytes, optimizedBytes, { meta });
  const web = await loadWebModule(
    path.join(webRoot, "src/lib/avatar/motion-authoring/headlessVrm.ts"),
  );
  try {
    const load = web.module.loadHeadlessVrmWithGltf;
    const [before, after] = [
      await loadedSummary(load, sourceBytes),
      await loadedSummary(load, optimizedBytes),
    ];
    if (JSON.stringify(before) !== JSON.stringify(after))
      differences.push("three-vrm load summary differs");
  } finally {
    await web.close();
  }
  return differences;
}

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;

async function optimizeCommand(source, options) {
  if (!options.out) throw new Error(`--out is required.\n\n${USAGE}`);
  const meta = await readMeta(options.meta);
  const sourceBytes = await readBytes(source);
  const { bytes, report } = await optimizeVrm(sourceBytes, { meta });
  for (const image of report.images) {
    console.log(
      `  image ${image.index} ${image.name} (${image.role}): ${megabytes(image.before)} → ${megabytes(image.after)}`,
    );
  }
  const { sparse, zeroFilled, dense } = report.morphs;
  console.log(
    `  morph accessors: ${sparse} sparse, ${zeroFilled} all-zero, ${dense} dense`,
  );
  const differences = await verify(sourceBytes, bytes, meta);
  if (differences.length) {
    throw new Error(
      `The optimized file is not equivalent:\n${differences.join("\n")}`,
    );
  }
  await writeFile(options.out, bytes);
  console.log(
    `${path.basename(source)}: ${megabytes(report.before)} → ${megabytes(report.after)}, verified`,
  );
}

async function verifyCommand(source, optimized, options) {
  const differences = await verify(
    await readBytes(source),
    await readBytes(optimized),
    await readMeta(options.meta),
  );
  if (differences.length) {
    console.error(differences.join("\n"));
    return 1;
  }
  console.log(
    "Equivalent: only images, buffer storage and the stated meta differ.",
  );
  return 0;
}

/** Peak signal-to-noise ratio of two same-sized RGB renders, in dB. */
async function psnr(left, right) {
  const [a, b] = await Promise.all(
    [left, right].map((image) => sharp(image).removeAlpha().raw().toBuffer()),
  );
  let squared = 0;
  for (let index = 0; index < a.length; index += 1)
    squared += (a[index] - b[index]) ** 2;
  const mse = squared / a.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

async function compareCommand(source, optimized, options) {
  if (!options.out) throw new Error(`--out is required.\n\n${USAGE}`);
  const minimum = Number(options["min-psnr"] ?? 45);
  const { chromium } = await import("playwright");
  const { createServer } = await import("vite");
  const files = [path.resolve(source), path.resolve(optimized)];
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-vrm-compare"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"vrm-compare"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    optimizeDeps: {
      entries: [path.join(webRoot, "scripts/vrm-optimize/compare/page.ts")],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [webRoot, ...files.map((file) => path.dirname(file))] },
    },
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
    // A page error (such as a failed module import) ends the wait early.
    const pageError = new Promise((_, reject) => page.on("pageerror", reject));
    pageError.catch(() => undefined);
    await page.goto(`${origin}/scripts/vrm-optimize/compare/index.html`);
    await Promise.race([
      page.waitForFunction(() => window.vrmComparisonReady === true, null, {
        timeout: 120_000,
      }),
      pageError,
    ]);
    const shots = await page.evaluate(
      (request) => window.renderVrmComparison(request),
      [
        { key: "source", url: `${origin}/@fs${files[0]}` },
        { key: "optimized", url: `${origin}/@fs${files[1]}` },
      ],
    );
    await mkdir(options.out, { recursive: true });
    let failed = 0;
    for (const view of ["face", "torso", "body", "back"]) {
      const images = ["source", "optimized"].map((key) =>
        Buffer.from(shots[`${key}.${view}`].split(",")[1], "base64"),
      );
      await Promise.all(
        images.map((image, index) =>
          writeFile(
            path.join(
              options.out,
              `${view}.${["source", "optimized"][index]}.png`,
            ),
            image,
          ),
        ),
      );
      const score = await psnr(...images);
      if (score < minimum) failed += 1;
      console.log(
        `  ${view}: ${score === Infinity ? "identical" : `${score.toFixed(1)} dB`}${score < minimum ? " (below minimum)" : ""}`,
      );
    }
    return failed ? 1 : 0;
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function main(argv) {
  const { positional, options, help } = parseArgs(argv);
  const [first, ...rest] = positional;
  if (help || !first) {
    console.log(USAGE);
    return help ? 0 : 2;
  }
  if (first === "verify" && rest.length === 2)
    return verifyCommand(rest[0], rest[1], options);
  if (first === "compare" && rest.length === 2)
    return compareCommand(rest[0], rest[1], options);
  if (rest.length === 0) {
    await optimizeCommand(first, options);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
