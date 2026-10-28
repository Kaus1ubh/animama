import assert from "node:assert/strict";
import test from "node:test";

import {
  LILTOON_VARIANT_FEATURES,
  buildLayers,
  lilToonFeaturesOf,
} from "./breakdownPlan.ts";

const without = (id: string, variant: string) =>
  LILTOON_VARIANT_FEATURES.find((feature) => feature.id === id)!.without(
    variant,
  );

test("removing a pass selects the lilToon variant without it", () => {
  assert.equal(without("outline", "Hidden/lilToonOutline"), "lilToon");
  assert.equal(
    without("outline", "Hidden/lilToonTwoPassTransparentOutline"),
    "Hidden/lilToonTwoPassTransparent",
  );
  assert.equal(without("outline", "lilToon"), null);
  assert.equal(
    without("two-pass", "Hidden/lilToonTwoPassTransparentOutline"),
    "Hidden/lilToonTransparentOutline",
  );
  assert.equal(without("two-pass", "Hidden/lilToonTransparent"), null);
  assert.equal(
    without("blending", "Hidden/lilToonOnePassTransparent"),
    "Hidden/lilToonCutout",
  );
  assert.equal(
    without("blending", "Hidden/lilToonTransparentOutline"),
    "Hidden/lilToonCutoutOutline",
  );
  assert.equal(without("blending", "Hidden/lilToonCutout"), null);
  assert.equal(
    without("alpha-test", "Hidden/lilToonCutoutOutline"),
    "Hidden/lilToonOutline",
  );
  assert.equal(without("alpha-test", "Hidden/lilToonFurCutout"), null);
});

test("a material uses the features whose switches are on", () => {
  assert.deepEqual(
    lilToonFeaturesOf({
      shaderVariant: "Hidden/lilToonCutoutOutline",
      properties: {
        _UseShadow: 1,
        _UseRim: 0,
        _UseMatCap2nd: [1, 0, 0, 0],
        _UseEmission: true,
        _UseBumpMap: { x: 0, y: 1 },
      },
    }),
    ["shadow", "matcap", "emission", "outline", "alpha-test"],
  );
  assert.deepEqual(
    lilToonFeaturesOf({ shaderVariant: "lilToon", properties: {} }),
    [],
  );
});

test("layers group primitives by face part, eye whites, blending and the rest", () => {
  const layers = buildLayers({
    roles: {
      face_skin: {
        bindings: ["0:0:0"],
        regions: [{ bindingKey: "0:0:0", triangles: [1, 2] }],
      },
      eye_left: { bindings: ["0:0:1"] },
      eye_right: { bindings: ["0:0:1"] },
      eye_highlight: { bindings: ["0:0:1"] },
      eyelash: {
        bindings: [],
        regions: [{ bindingKey: "0:0:0", triangles: [5, 6] }],
      },
      hair: { bindings: ["1:1:0"] },
    },
    eyeWhites: ["2:2:0"],
    primitives: [
      { bindingKey: "0:0:0", blend: "opaque" },
      { bindingKey: "0:0:1", blend: "opaque" },
      { bindingKey: "1:1:0", blend: "cutout" },
      { bindingKey: "2:2:0", blend: "opaque" },
      { bindingKey: "3:3:0", blend: "transparent" },
      { bindingKey: "4:4:0", blend: "opaque" },
    ],
  });
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  assert.deepEqual(
    layers.map((layer) => layer.id),
    [
      "eye-stack",
      "irises",
      "eye-highlights",
      "eye-whites",
      "eyelashes",
      "face-skin",
      "hair",
      "transparent",
      "cutout",
      "rest",
    ],
  );
  assert.deepEqual(byId.get("eye-stack")!.bindings, ["0:0:1", "2:2:0"]);
  assert.deepEqual(byId.get("eye-stack")!.shared, []);
  // Highlights share the iris primitive, so hiding it hides more.
  assert.deepEqual(byId.get("eye-highlights")!.shared, ["0:0:1"]);
  // Lashes drawn inside the face primitive hide as regions only.
  assert.deepEqual(byId.get("eyelashes")!.bindings, []);
  assert.deepEqual(byId.get("eyelashes")!.regions, [
    { bindingKey: "0:0:0", triangles: [5, 6] },
  ]);
  assert.deepEqual(byId.get("face-skin")!.shared, ["0:0:0"]);
  // The face skin hides its own primitive whole; its region adds nothing.
  assert.deepEqual(byId.get("face-skin")!.regions, []);
  assert.deepEqual(byId.get("transparent")!.bindings, ["3:3:0"]);
  assert.deepEqual(byId.get("rest")!.bindings, ["3:3:0", "4:4:0"]);
});
