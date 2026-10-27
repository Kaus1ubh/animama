import assert from "node:assert/strict";
import { test } from "node:test";

import { BREAKDOWN_KINDS, parseBenchArgs } from "./effect-bench.mjs";

test("defaults keep the effects comparison at the chat's DPR", () => {
  const { options } = parseBenchArgs([]);
  assert.equal(options.frames, 600);
  assert.deepEqual(options.pixelRatios, [2]);
  assert.equal(options.materials, "automatic");
  assert.equal(options.fps, null);
  assert.deepEqual(options.apply, []);
  assert.equal(options.breakdown, null);
});

test("breakdown options parse into kinds, pixel ratios and changes", () => {
  const { options } = parseBenchArgs([
    "--avatar-file",
    "a.vrm",
    "--breakdown",
    "features, layers",
    "--materials",
    "simple",
    "--pixel-ratios",
    "1,1.5,2",
    "--fps",
    "30",
    "--apply",
    "outline,depth-prepass",
  ]);
  assert.deepEqual(options.breakdown, ["features", "layers"]);
  assert.equal(options.materials, "simple");
  assert.deepEqual(options.pixelRatios, [1, 1.5, 2]);
  assert.equal(options.fps, 30);
  assert.deepEqual(options.apply, ["outline", "depth-prepass"]);
  assert.deepEqual(parseBenchArgs(["--breakdown", "all"]).options.breakdown, [
    ...BREAKDOWN_KINDS,
  ]);
});

test("invalid values and misplaced options are refused", () => {
  for (const argv of [
    ["--breakdown", "shadows"],
    ["--breakdown", ""],
    ["--materials", "mtoon"],
    ["--pixel-ratios", "0"],
    ["--pixel-ratios", "2,x"],
    ["--fps", "0"],
    ["--breakdown", "features", "--effects", "a"],
    ["--reaction", "r", "--pixel-ratios", "1"],
    ["--reaction", "r", "--breakdown", "features"],
    ["--frames"],
    ["--unknown"],
  ])
    assert.ok(parseBenchArgs(argv).error, argv.join(" "));
});
