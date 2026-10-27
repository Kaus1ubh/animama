import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWebModule } from "./effects.mjs";
import { readGlb, writeGlb } from "./vrm-optimize/glb.mjs";

/**
 * Bake VRM 1.0 mood presets from an Avatar's ARKit face shapes:
 *
 *   pnpm -s vrm:bake-expressions <source.vrm> --out <baked.vrm> [--replace]
 *
 * Writes happy, angry, sad, relaxed and surprised as morph-target binds built
 * from the ARKit mixes Animama plays on ARKit Avatars
 * (`src/lib/avatar/arkitFaceCompositions.json`), plus an empty neutral, so the
 * file emotes in other VRM apps too. Animama composes each mood from the
 * Avatar's MMD morphs and ARKit shapes region by region; a mood it cannot
 * compose entirely (or any mood, on an Avatar with VRoid mood parts) plays the
 * baked preset instead, and the command says whether any does.
 * Presets that already bind something are kept unless `--replace`; an authored
 * neutral is always kept. Only the JSON's preset entries change; the binary
 * chunk is written back byte for byte and every other JSON value, extensions
 * included, unchanged in value. The source is never modified and an existing
 * output is never overwritten.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE =
  "Usage: pnpm -s vrm:bake-expressions <source.vrm> --out <baked.vrm> [--replace]";

/** The presets this command writes, in VRM order. */
export const BAKED_PRESETS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "neutral",
];

/** Whether an expression binds anything (an empty placeholder does not). */
function bindsSomething(expression) {
  return ["morphTargetBinds", "materialColorBinds", "textureTransformBinds"]
    .map((key) => expression?.[key])
    .some((binds) => Array.isArray(binds) && binds.length > 0);
}

/**
 * Morph-target names per node: the nodes the VRM's binds reference, each with
 * its mesh's mesh-level `extras.targetNames` (the names three.js loads).
 * Meshes that name their targets only per primitive are counted, since the
 * app cannot use those names either.
 */
function nodeMorphNames(json) {
  const nodes = [];
  const primitiveOnlyMeshes = new Set();
  (json.nodes ?? []).forEach((node, nodeIndex) => {
    const mesh = json.meshes?.[node.mesh];
    const names = mesh?.extras?.targetNames;
    if (Array.isArray(names)) nodes.push({ node: nodeIndex, names });
    else if (
      mesh?.primitives?.some((primitive) =>
        Array.isArray(primitive.extras?.targetNames),
      )
    )
      primitiveOnlyMeshes.add(node.mesh);
  });
  return { nodes, primitiveOnlyMeshes: primitiveOnlyMeshes.size };
}

/**
 * Add the presets to a parsed VRM 1.0 document in place.
 *
 * @param resolveArkitFacesPerMesh From `arkitFaceCapability.ts`.
 * @param moodMixes `ARKIT_MOOD_MIXES` from `arkitFaceCompositions.ts`.
 * @param isVroidMoodPart From the same module.
 * @returns Which presets were written or kept; ARKit shapes the written
 *   presets use that the file lacks, or has several equal candidates for; how
 *   many meshes name their morph targets only per primitive; and whether
 *   Animama will play any baked preset (it composes a mood itself when every
 *   shape of that mood resolves and the Avatar has no VRoid mood parts; MMD
 *   morphs, which this JSON-only check does not see, can only add moods).
 */
export function bakeExpressions(
  json,
  { resolveArkitFacesPerMesh, moodMixes, isVroidMoodPart, replace = false },
) {
  const vrm = json.extensions?.VRMC_vrm;
  if (!vrm) {
    throw new Error(
      json.extensions?.VRM
        ? "VRM 0.x files are not supported; export the Avatar as VRM 1.0."
        : "The file is not a VRM: no VRMC_vrm extension found.",
    );
  }
  const { nodes, primitiveOnlyMeshes } = nodeMorphNames(json);
  // Each mesh binds its own spelling of a shape, as the app does.
  const faces = resolveArkitFacesPerMesh(nodes.map(({ names }) => names));
  const { capability } = faces;
  const custom = vrm.expressions?.custom ?? {};
  const binds = (mix) =>
    Object.entries(mix).flatMap(([shape, weight]) => {
      // As in the app, an expression the file authors under the ARKit name
      // stands for the shape, even with no morph binds: its binds are scaled
      // by the mix (a missing weight is 1, as three-vrm reads it).
      if (custom[shape] !== undefined)
        return (custom[shape].morphTargetBinds ?? []).map((bind) => ({
          ...bind,
          weight: (bind.weight ?? 1) * weight,
        }));
      return nodes.flatMap(({ node, names }, meshIndex) =>
        (faces.meshes[meshIndex].get(shape) ?? []).map((morph) => ({
          node,
          index: names.indexOf(morph),
          weight,
        })),
      );
    });

  vrm.expressions ??= {};
  vrm.expressions.preset ??= {};
  const presets = vrm.expressions.preset;
  const written = [];
  const kept = [];
  for (const name of BAKED_PRESETS) {
    // The table has no neutral mix, so an authored neutral is always kept.
    const keep =
      name === "neutral"
        ? presets.neutral !== undefined
        : bindsSomething(presets[name]) && !replace;
    if (keep) {
      kept.push(name);
      continue;
    }
    // A replaced preset is rewritten whole, material binds included.
    presets[name] = {
      morphTargetBinds: name === "neutral" ? [] : binds(moodMixes[name]),
      isBinary: false,
      overrideBlink: "none",
      overrideLookAt: "none",
      overrideMouth: "none",
    };
    written.push(name);
  }
  const shapesOf = (names) => [
    ...new Set(names.flatMap((name) => Object.keys(moodMixes[name] ?? {}))),
  ];
  const used = shapesOf(written).filter(
    (shape) => !capability.resolved.has(shape),
  );
  // As `registerArkitFace` decides for ARKit: a mood whose every shape
  // resolves is composed by the app (its baked preset is replaced); VRoid
  // mood parts, as morph targets or authored custom expressions, keep the
  // file's own faces.
  const ownParts = [
    ...nodes.flatMap(({ names }) => names),
    ...Object.keys(vrm.expressions.custom ?? {}),
  ].some(isVroidMoodPart);
  const appPlaysOwnMixes =
    !ownParts &&
    Object.values(moodMixes).every((mix) =>
      Object.keys(mix).every((shape) => capability.resolved.has(shape)),
    );
  return {
    written,
    kept,
    missingShapes: used.filter((shape) => !capability.ambiguous.has(shape)),
    ambiguousShapes: used.filter((shape) => capability.ambiguous.has(shape)),
    primitiveOnlyMeshes,
    animamaPlaysBakedPresets: !appPlaysOwnMixes,
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main(argv) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const replace = argv.includes("--replace");
  const rest = argv.filter((value) => value !== "--replace");
  const outIndex = rest.indexOf("--out");
  const out = outIndex >= 0 ? rest[outIndex + 1] : undefined;
  const positional = rest.filter(
    (_, index) => index !== outIndex && index !== outIndex + 1,
  );
  const unknown = positional.find((value) => value.startsWith("--"));
  if (unknown || positional.length !== 1 || !out || out.startsWith("--")) {
    console.error(unknown ? `Unknown option ${unknown}.\n\n${USAGE}` : USAGE);
    return 2;
  }
  const source = positional[0];
  if (path.resolve(source) === path.resolve(out)) {
    throw new Error("--out must differ from the source; it is never modified.");
  }
  if (await exists(out)) {
    throw new Error(`${out} already exists; choose a new output file.`);
  }

  const document = readGlb(new Uint8Array(await readFile(source)));
  const web = await loadWebModule(
    path.join(webRoot, "src/lib/avatar/arkitFaceCapability.ts"),
  );
  let report;
  try {
    const compositions = await web.load(
      path.join(webRoot, "src/lib/avatar/arkitFaceCompositions.ts"),
    );
    report = bakeExpressions(document.json, {
      resolveArkitFacesPerMesh: web.module.resolveArkitFacesPerMesh,
      moodMixes: compositions.ARKIT_MOOD_MIXES,
      isVroidMoodPart: compositions.isVroidMoodPart,
      replace,
    });
  } finally {
    await web.close();
  }
  const bytes = writeGlb(document.json, document.bin);
  try {
    // `wx` refuses an output that appeared since the check above.
    await writeFile(out, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`${out} already exists; choose a new output file.`);
    }
    // This process created the file, so a failed write leaves nothing behind.
    await rm(out, { force: true });
    throw error;
  }
  console.log(`written: ${report.written.join(", ") || "none"}`);
  if (report.kept.length)
    console.log(`kept (already authored): ${report.kept.join(", ")}`);
  if (report.missingShapes.length)
    console.log(`ARKit shapes not found: ${report.missingShapes.join(", ")}`);
  if (report.ambiguousShapes.length)
    console.log(
      `ARKit shapes with several equal candidates: ${report.ambiguousShapes.join(", ")}`,
    );
  if (report.primitiveOnlyMeshes)
    console.log(
      `${report.primitiveOnlyMeshes} mesh(es) name morph targets only per primitive, which the app ignores; see vrm:inspect.`,
    );
  console.log(
    report.animamaPlaysBakedPresets
      ? "Animama plays these baked presets for the moods it cannot compose from the Avatar's MMD morphs and ARKit shapes; vrm:inspect lists each mood's sources."
      : "Animama plays its own ARKit mixes on this Avatar; the baked presets serve other VRM apps.",
  );
  return 0;
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
