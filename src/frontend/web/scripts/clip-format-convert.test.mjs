import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runClipFormatConvert } from "./clip-format-convert.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");

/** A Local root with a 1.0 Gesture and Reaction and a 2.0 Gesture. */
function localRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "clip-format-convert-"));
  const write = (relative, value) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), JSON.stringify(value));
  };
  write("gestures/old/old.json", { schema: "animaPoseClip/1.0", id: "old" });
  write("gestures/old/old.meta.json", { schema: "animaPoseClip/1.0" });
  write("reactions/joy-1/joy-1.json", {
    schema: "animaPoseClip/1.0",
    id: "joy-1",
  });
  write("gestures/new/new.json", { schema: "animaPoseClip/2.0", id: "new" });
  return root;
}

/** Converts every 1.0 clip to a marker 2.0 file. */
const load = async () => ({
  convertClipFileText(text) {
    const clip = JSON.parse(text);
    return clip.schema === "animaPoseClip/1.0"
      ? {
          status: "converted",
          saved: JSON.stringify({ schema: "animaPoseClip/2.0", id: clip.id }),
          bytesBefore: text.length,
          bytesAfter: 0,
          beats: 1,
          error: { degrees: 0, metres: 0, weight: 0, added: {} },
        }
      : { status: "skipped", schema: clip.schema };
  },
});

async function run(args, root) {
  const lines = [];
  const code = await runClipFormatConvert(args, {
    load,
    repoRoot,
    cwd: root,
    out: (line) => lines.push(line),
  });
  return { code, lines };
}

const schemaOf = (root, relative) =>
  JSON.parse(readFileSync(path.join(root, relative), "utf8")).schema;

test("a Local dry run lists the 1.0 clips and writes nothing", async () => {
  const root = localRoot();
  try {
    const { code, lines } = await run(
      ["--local-root", root, "--dry-run"],
      root,
    );
    assert.equal(code, 0);
    assert.equal(
      lines.at(-1),
      "2 clip(s) to convert, 0 failed (dry run: nothing written).",
    );
    assert.equal(schemaOf(root, "gestures/old/old.json"), "animaPoseClip/1.0");
    assert.equal(
      existsSync(path.join(root, "gestures/old/old.json.v1.bak")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("a Local run converts 1.0 clips in place and keeps a backup", async () => {
  const root = localRoot();
  try {
    const { code } = await run(["--local-root", root], root);
    assert.equal(code, 0);
    for (const file of [
      "gestures/old/old.json",
      "reactions/joy-1/joy-1.json",
    ]) {
      assert.equal(schemaOf(root, file), "animaPoseClip/2.0");
      assert.equal(schemaOf(root, `${file}.v1.bak`), "animaPoseClip/1.0");
    }
    // Control documents and 2.0 clips are left alone.
    assert.equal(
      schemaOf(root, "gestures/old/old.meta.json"),
      "animaPoseClip/1.0",
    );
    assert.equal(
      existsSync(path.join(root, "gestures/new/new.json.v1.bak")),
      false,
    );
    // Rerunning finds nothing left to convert.
    const again = await run(["--local-root", root, "--dry-run"], root);
    assert.match(again.lines.at(-1), /^0 clip\(s\) to convert/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("writes nothing for a clip that fails to convert", async () => {
  const root = localRoot();
  try {
    const failing = async () => ({
      convertClipFileText: (text) =>
        JSON.parse(text).schema === "animaPoseClip/1.0"
          ? { status: "failed", message: "unresolved Pose references: mine" }
          : { status: "skipped", schema: "animaPoseClip/2.0" },
    });
    const lines = [];
    const code = await runClipFormatConvert(["--local-root", root], {
      load: failing,
      repoRoot,
      cwd: root,
      out: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.ok(lines.some((line) => line.startsWith("FAILED")));
    assert.equal(schemaOf(root, "gestures/old/old.json"), "animaPoseClip/1.0");
    assert.equal(
      existsSync(path.join(root, "gestures/old/old.json.v1.bak")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("converts a real 1.0 Gesture through the CLI", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "clip-format-convert-"));
  try {
    const file = path.join(root, "gestures/meme-dab/meme-dab.json");
    mkdirSync(path.dirname(file), { recursive: true });
    // A small 1.0 Gesture with an inline pose and a built-in base pose.
    writeFileSync(
      file,
      JSON.stringify({
        schema: "animaPoseClip/1.0",
        id: "meme-dab",
        name: "Meme Dab",
        duration: 1,
        basePose: "relaxedRest",
        poses: {
          tilt: { humanoid: { head: { rotation: [0, 0.2588, 0, 0.9659] } } },
        },
        poseKeyframes: [
          { time: 0, pose: "tilt" },
          { time: 1, pose: "tilt" },
        ],
      }),
    );
    const output = execFileSync(
      process.execPath,
      ["scripts/animation.mjs", "convert-v1", "--local-root", root],
      { cwd: webRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    assert.match(output, /1 clip\(s\) converted, 0 failed\./);
    assert.equal(
      JSON.parse(readFileSync(file, "utf8")).schema,
      "animaPoseClip/2.0",
    );
    assert.ok(existsSync(`${file}.v1.bak`));
  } finally {
    rmSync(root, { recursive: true });
  }
});
