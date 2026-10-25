import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { defaultTimes, renderGestureSheet } from "./animation-render.mjs";

const avatarDir = path.resolve(
  import.meta.dirname,
  "../../../../content/included/avatars",
);

// Real WebGL rendering of a review sheet on both Included Avatars.
test("renders a non-empty Gesture review sheet", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-render-"));
  try {
    const clip = {
      schema: "animaPoseClip/2.0",
      id: "render-probe",
      name: "Render Probe",
      duration: 1,
      basePose: "relaxedRest",
      beats: [
        { id: "a", label: "A", time: 0 },
        { id: "b", label: "B", time: 1 },
      ],
      rotations: {
        head: [
          { beat: "a", q: [0, 0, 0, 1] },
          { beat: "b", q: [0, 0.2588, 0, 0.9659] },
        ],
      },
    };
    const outFile = path.join(dir, "render-probe.png");
    const result = await renderGestureSheet({
      clip,
      times: defaultTimes(1, 2),
      outFile,
      tile: { width: 96, height: 144 },
    });
    assert.deepEqual(result.missingPoseRefs, []);
    const png = await readFile(outFile);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    // 64 px labels + 8 tiles (4 per Avatar) wide, 28 px header + 2 rows tall.
    assert.equal(png.readUInt32BE(16), 64 + 8 * 96);
    assert.equal(png.readUInt32BE(20), 28 + 2 * 144);
    assert.ok(png.length > 20_000, `sheet is only ${png.length} bytes`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A local Avatar file replaces both Included Avatars: one Avatar's views.
test("renders on one local VRM with avatarFile", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-render-"));
  try {
    const outFile = path.join(dir, "local.png");
    await renderGestureSheet({
      clip: {
        schema: "animaPoseClip/2.0",
        id: "render-local",
        name: "Render Local",
        duration: 1,
        basePose: "relaxedRest",
        beats: [{ id: "a", label: "A", time: 0 }],
        rotations: { head: [{ beat: "a", q: [0, 0, 0, 1] }] },
      },
      times: [0],
      outFile,
      tile: { width: 96, height: 144 },
      avatarFile: path.join(avatarDir, "Andrew.vrm"),
    });
    const png = await readFile(outFile);
    assert.equal(png.readUInt32BE(16), 64 + 4 * 96);
    assert.equal(png.readUInt32BE(20), 28 + 144);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
