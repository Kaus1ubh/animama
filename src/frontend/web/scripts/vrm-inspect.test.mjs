import assert from "node:assert/strict";
import { before, test } from "node:test";

import { faceFixtureVrm } from "./testing/faceFixtureVrm.mjs";
import { formatReport, inspectVrm } from "./vrm-inspect.mjs";

/**
 * "Face" names its ARKit-style morph targets at mesh level, as three.js reads
 * them, and authors one expression under an ARKit name; "Body" names its
 * target only per primitive, which the Avatar loaders apply; "Hair" stores a
 * per-primitive list that does not fit its one target, so it loads unnamed.
 * One material carries the Mochiya lilToon extension.
 */
const fixture = () =>
  faceFixtureVrm({
    meshes: [
      {
        name: "Face",
        names: ["MouthSmile_L", "Jaw_Open", "vrc.v_aa", "eyeBlinkLeft"],
      },
      { name: "Body", names: ["browInnerUp"], perPrimitive: true },
      {
        name: "Hair",
        names: ["cheekPuff"],
        perPrimitive: ["cheekPuff", "mouthClose"],
      },
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
      {
        name: "Hair",
        morphTargets: 1,
        morphNames: "primitives, mismatched",
        targetNames: [],
      },
    ],
  );
  // Positions plus one shared target accessor: 2 × 4 vertices × 12 bytes.
  assert.equal(report.meshes[0].bytes, 96);
  const text = formatReport(report);
  assert.match(text, /Body: .*names stored: primitives only\n/);
  assert.match(text, /Hair: .*so they load unnamed/);
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

test("resolves ARKit shapes from the names the Avatar loaders produce", () => {
  const { arkit } = report.loaded;
  assert.equal(arkit.resolved, 4);
  assert.deepEqual(arkit.authored, ["eyeBlinkLeft"]);
  assert.deepEqual(arkit.renamed, {
    jawOpen: ["Jaw_Open"],
    mouthSmileLeft: ["MouthSmile_L"],
  });
  // The per-primitive name reaches the app; the mismatched list does not.
  assert.ok(!arkit.missing.includes("browInnerUp"));
  assert.ok(arkit.missing.includes("cheekPuff"));
  assert.equal(arkit.total, 52);
  // Four shapes are far short of the table, so the app keeps its presets.
  assert.equal(arkit.playsFacesWithArkit, false);
  const text = formatReport(report);
  assert.match(text, /ARKit shapes: 4 of 52/);
  assert.match(text, /Animama plays the file's presets/);
});

test("reports where each blink and viseme comes from, and the face parts", () => {
  const { faceSignals, face } = report.loaded;
  // The file's `aa` preset binds nothing, so VRChat's viseme plays it; only
  // the left eye has an ARKit blink, so `blink` itself has no source.
  assert.equal(faceSignals.aa, "vrchat");
  assert.equal(faceSignals.blinkLeft, "arkit");
  assert.equal(faceSignals.blink, "none");
  // The fixture's meshes are not skinned to a head, so no face is found.
  assert.equal(face.parts.face_skin.source, "missing");
  assert.deepEqual(face.issues, ["face_parts_expressions_missing"]);
  const text = formatReport(report);
  assert.match(
    text,
    /blink and visemes: blink none, blinkLeft ARKit, .*aa VRChat/,
  );
  assert.match(text, /face parts: face_skin missing, eye_left missing/);
  assert.match(text, /issues: face_parts_expressions_missing/);
});

test("says what places eyes without geometry of their own", () => {
  const estimated = {
    ...report,
    loaded: {
      ...report.loaded,
      face: {
        parts: {
          ...report.loaded.face.parts,
          face_skin: { source: "signals", bindings: 1, regions: 0 },
          eye_left: {
            source: "estimated",
            bindings: 0,
            regions: 0,
            estimate: "blink",
          },
          eye_right: {
            source: "estimated",
            bindings: 0,
            regions: 0,
            estimate: "eye_bone",
          },
        },
        issues: [],
      },
    },
  };
  const text = formatReport(estimated);
  assert.match(
    text,
    /eye_left estimated from blinking, eye_right estimated from its eye bone,/,
  );
});

test("says why face part detection failed", () => {
  const failed = {
    ...report,
    loaded: {
      ...report.loaded,
      face: {
        parts: null,
        issues: ["face_parts_detection_failed"],
        error: "unexpected primitive",
      },
    },
  };
  const text = formatReport(failed);
  assert.match(text, /face parts: detection failed \(unexpected primitive\)/);
  assert.match(text, /issues: face_parts_detection_failed/);
});
