import assert from "node:assert/strict";
import { before, test } from "node:test";

import { faceFixtureVrm } from "./testing/faceFixtureVrm.mjs";
import { formatReport, inspectVrm } from "./vrm-inspect.mjs";

/**
 * "Face" names its ARKit-style morph targets at mesh level, as three.js reads
 * them, and authors one expression under an ARKit name; "Body" names its
 * target only per primitive. One material carries the Mochiya lilToon
 * extension.
 */
const fixture = () =>
  faceFixtureVrm({
    meshes: [
      {
        name: "Face",
        names: ["MouthSmile_L", "Jaw_Open", "vrc.v_aa", "eyeBlinkLeft"],
      },
      { name: "Body", names: ["browInnerUp"], perPrimitive: true },
    ],
    json: {
      extensionsUsed: ["VRMC_vrm", "MOCHIYA_materials_liltoon"],
      materials: [
        {
          name: "Skin",
          extensions: { MOCHIYA_materials_liltoon: { specVersion: "1.3" } },
        },
      ],
    },
    vrm: {
      expressions: {
        preset: { aa: { morphTargetBinds: [] } },
        custom: {
          eyeBlinkLeft: {
            morphTargetBinds: [{ node: 15, index: 3, weight: 1 }],
          },
        },
      },
    },
  });

let report;
before(async () => {
  report = await inspectVrm(fixture().bytes);
});

test("lists each mesh's morph names, their storage and size", () => {
  assert.deepEqual(
    report.meshes.map(({ name, morphTargets, morphNames, targetNames }) => ({
      name,
      morphTargets,
      morphNames,
      targetNames,
    })),
    [
      {
        name: "Face",
        morphTargets: 4,
        morphNames: "mesh",
        targetNames: ["MouthSmile_L", "Jaw_Open", "vrc.v_aa", "eyeBlinkLeft"],
      },
      {
        name: "Body",
        morphTargets: 1,
        morphNames: "primitives only",
        targetNames: ["browInnerUp"],
      },
    ],
  );
  // Positions plus one shared target accessor: 2 × 4 vertices × 12 bytes.
  assert.equal(report.meshes[0].bytes, 96);
  const text = formatReport(report);
  assert.match(text, /Body: .*three\.js ignores these names/);
  assert.match(text, /MouthSmile_L, Jaw_Open, vrc\.v_aa, eyeBlinkLeft/);
});

test("reports version, extensions, materials and authored expressions", () => {
  assert.equal(report.vrmVersion, "VRM 1.0");
  assert.equal(report.overUploadLimit, false);
  assert.ok(report.extensionsUsed.includes("MOCHIYA_materials_liltoon"));
  assert.deepEqual(report.materials, {
    total: 1,
    mtoon: 0,
    liltoon: 1,
    unlit: 0,
  });
  assert.deepEqual(report.expressions, {
    preset: ["aa"],
    custom: ["eyeBlinkLeft"],
  });
});

test("resolves ARKit shapes from the names three.js loads", () => {
  const { arkit } = report.loaded;
  assert.equal(arkit.resolved, 3);
  assert.deepEqual(arkit.authored, ["eyeBlinkLeft"]);
  assert.deepEqual(arkit.renamed, {
    jawOpen: ["Jaw_Open"],
    mouthSmileLeft: ["MouthSmile_L"],
  });
  // The primitive-only name never reaches the app.
  assert.ok(arkit.missing.includes("browInnerUp"));
});
