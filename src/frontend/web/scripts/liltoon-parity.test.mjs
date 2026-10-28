import assert from "node:assert/strict";
import { test } from "node:test";

import { parseParityArgs } from "./liltoon-parity.mjs";

test("parity options take an Avatar file, an output folder and a size", () => {
  const { options } = parseParityArgs([
    "--avatar-file",
    "a.vrm",
    "--out",
    "renders",
    "--size",
    "320x400",
  ]);
  assert.deepEqual(options, {
    avatarFile: "a.vrm",
    out: "renders",
    width: 320,
    height: 400,
  });
  assert.equal(
    parseParityArgs(["--avatar-file", "a.vrm", "--out", "r"]).options.width,
    640,
  );
});

test("invalid parity options are refused", () => {
  for (const argv of [
    [],
    ["--avatar-file", "a.vrm"],
    ["--out", "r"],
    ["--avatar-file", "a.vrm", "--out", "r", "--size", "10x10"],
    ["--avatar-file", "a.vrm", "--out", "r", "--size", "big"],
    ["--avatar-file", "--out", "r"],
    ["--unknown"],
  ])
    assert.ok(parseParityArgs(argv).error, argv.join(" "));
  assert.equal(parseParityArgs(["--help"]).help, true);
});
