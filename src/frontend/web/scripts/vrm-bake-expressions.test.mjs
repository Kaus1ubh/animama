import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadWebModule } from "./effects.mjs";
import { faceFixtureVrm } from "./testing/faceFixtureVrm.mjs";
import { bakeExpressions } from "./vrm-bake-expressions.mjs";
import { readGlb } from "./vrm-optimize/glb.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const script = path.join(webRoot, "scripts/vrm-bake-expressions.mjs");
const run = promisify(execFile);

/** Face shapes for sad and happy only, split across two meshes. */
const fixture = () =>
  faceFixtureVrm({
    meshes: [
      {
        name: "Face",
        names: ["BrowInnerUp", "MouthFrown_L", "MouthFrown_R", "MouthSmile_L"],
      },
      { name: "Teeth", names: ["mouthSmileLeft", "mouthShrugLower"] },
    ],
    json: {
      extensionsUsed: [
        "VRMC_vrm",
        "VRMC_springBone",
        "MOCHIYA_materials_liltoon",
      ],
      materials: [
        {
          name: "Skin",
          extras: { note: "kept" },
          extensions: {
            MOCHIYA_materials_liltoon: {
              specVersion: "1.3",
              shader: "lilToon",
              properties: { _UseShadow: 1, _ShadowBorder: 0.5 },
            },
          },
        },
      ],
      extensions: {
        VRMC_springBone: {
          specVersion: "1.0",
          springs: [{ joints: [{ node: 2, stiffness: 0.8 }] }],
        },
      },
    },
    vrm: {
      expressions: {
        preset: {
          aa: { morphTargetBinds: [{ node: 15, index: 0, weight: 1 }] },
          angry: {
            morphTargetBinds: [{ node: 15, index: 0, weight: 0.5 }],
          },
          happy: { morphTargetBinds: [] },
        },
      },
    },
  });

let tools;
let arkitShapes;
let web;
let directory;
before(async () => {
  web = await loadWebModule(
    path.join(webRoot, "src/lib/avatar/arkitFaceCapability.ts"),
  );
  const compositions = await web.load(
    path.join(webRoot, "src/lib/avatar/arkitFaceCompositions.ts"),
  );
  tools = {
    resolveArkitFacesPerMesh: web.module.resolveArkitFacesPerMesh,
    moodMixes: compositions.ARKIT_MOOD_MIXES,
    tableShapes: compositions.ARKIT_COMPOSITION_SHAPES,
    isVroidMoodPart: compositions.isVroidMoodPart,
  };
  arkitShapes = (await web.load(path.join(webRoot, "src/lib/avatar/arkit.ts")))
    .ARKIT_BLENDSHAPES;
  directory = await mkdtemp(path.join(tmpdir(), "vrm-bake-"));
});
after(async () => {
  await web.close();
  await rm(directory, { recursive: true, force: true });
});

test("writes presets from the ARKit mixes on every mesh with the shape", () => {
  const { bytes, meshNode } = fixture();
  const { json } = readGlb(bytes);
  const report = bakeExpressions(json, tools);

  assert.deepEqual(report.written, [
    "happy",
    "sad",
    "relaxed",
    "surprised",
    "neutral",
  ]);
  assert.deepEqual(report.kept, ["angry"]);
  // Shapes only the kept angry uses are not reported.
  assert.ok(report.missingShapes.includes("jawOpen"));
  assert.ok(!report.missingShapes.includes("noseSneerLeft"));
  assert.deepEqual(report.ambiguousShapes, []);
  assert.equal(report.primitiveOnlyMeshes, 0);
  assert.equal(report.animamaPlaysBakedPresets, true);
  const preset = json.extensions.VRMC_vrm.expressions.preset;
  const sad = Object.fromEntries(
    preset.sad.morphTargetBinds.map(({ node, index, weight }) => [
      `${node}:${index}`,
      weight,
    ]),
  );
  assert.deepEqual(sad, {
    [`${meshNode}:0`]: 0.7,
    [`${meshNode}:1`]: 0.5,
    [`${meshNode}:2`]: 0.5,
    [`${meshNode + 1}:1`]: 0.2,
  });
  // Each mesh binds its own spelling of mouthSmileLeft.
  assert.deepEqual(preset.happy.morphTargetBinds, [
    { node: meshNode, index: 3, weight: 0.8 },
    { node: meshNode + 1, index: 0, weight: 0.8 },
  ]);
  assert.deepEqual(preset.neutral.morphTargetBinds, []);
  assert.deepEqual(preset.aa.morphTargetBinds, [
    { node: 15, index: 0, weight: 1 },
  ]);
  assert.deepEqual(preset.angry.morphTargetBinds, [
    { node: 15, index: 0, weight: 0.5 },
  ]);
});

test("--replace overwrites authored presets but keeps an authored neutral", () => {
  const { json } = readGlb(fixture().bytes);
  const neutral = { morphTargetBinds: [{ node: 15, index: 0, weight: 0.1 }] };
  json.extensions.VRMC_vrm.expressions.preset.neutral = neutral;
  const report = bakeExpressions(json, { ...tools, replace: true });
  assert.deepEqual(report.kept, ["neutral"]);
  assert.ok(report.written.includes("angry"));
  assert.deepEqual(
    json.extensions.VRMC_vrm.expressions.preset.neutral,
    neutral,
  );
});

test("reports ambiguous shapes and meshes named only per primitive", () => {
  const { json } = readGlb(
    faceFixtureVrm({
      meshes: [
        { name: "Face", names: ["MouthSmile_L", "mouth_smile_left"] },
        { name: "Hair", names: ["jawOpen"], perPrimitive: true },
      ],
    }).bytes,
  );
  // Two nodes share the per-primitive mesh; it still counts once.
  json.nodes.push({ mesh: 1 });
  const report = bakeExpressions(json, tools);
  assert.equal(report.primitiveOnlyMeshes, 1);
  assert.ok(report.missingShapes.includes("jawOpen"));
  assert.deepEqual(report.ambiguousShapes, ["mouthSmileLeft"]);
  assert.ok(!report.missingShapes.includes("mouthSmileLeft"));
});

test("says whether Animama plays its own mixes, as the runtime decides", () => {
  const baked = (names, custom) => {
    const { json } = readGlb(
      faceFixtureVrm({ meshes: [{ name: "Face", names }] }).bytes,
    );
    if (custom) json.extensions.VRMC_vrm.expressions = { custom };
    return bakeExpressions(json, tools).animamaPlaysBakedPresets;
  };
  assert.equal(baked(arkitShapes), false);
  assert.equal(baked([...arkitShapes, "Fcl_MTH_Fun"]), true);
  assert.equal(
    baked(arkitShapes, { Fcl_ALL_Joy: { morphTargetBinds: [] } }),
    true,
  );
});

test("refuses VRM 0.x files", () => {
  assert.throws(
    () => bakeExpressions({ extensions: { VRM: {} } }, tools),
    /VRM 0\.x files are not supported/,
  );
});

test("writes a new file, changes only presets and leaves the source", async () => {
  const { bytes } = fixture();
  const source = path.join(directory, "source.vrm");
  const out = path.join(directory, "baked.vrm");
  await writeFile(source, bytes);

  const { stdout } = await run("node", [script, source, "--out", out]);
  assert.match(stdout, /written: happy, sad, relaxed, surprised, neutral/);
  assert.match(stdout, /kept \(already authored\): angry/);
  assert.match(stdout, /Animama plays these baked presets/);
  assert.deepEqual((await readdir(directory)).sort(), [
    "baked.vrm",
    "source.vrm",
  ]);
  assert.deepEqual(new Uint8Array(await readFile(source)), bytes);

  const before = readGlb(bytes);
  const baked = readGlb(new Uint8Array(await readFile(out)));
  assert.ok(baked.bin.equals(before.bin));
  const withoutPresets = (json) => {
    const copy = structuredClone(json);
    delete copy.extensions.VRMC_vrm.expressions.preset;
    return copy;
  };
  assert.deepEqual(withoutPresets(baked.json), withoutPresets(before.json));

  await assert.rejects(
    run("node", [script, source, "--out", out]),
    /already exists/,
  );
  await assert.rejects(
    run("node", [script, source, "--out", source]),
    /must differ from the source/,
  );
});
