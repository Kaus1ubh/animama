import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { defaultTimes, renderGestureSheet } from "./animation-render.mjs";

// Real WebGL rendering of a review sheet on both Included Avatars.
test("renders a non-empty Gesture review sheet", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-render-"));
  try {
    const clip = {
      schema: "animaPoseClip/1.0",
      id: "render-probe",
      name: "Render Probe",
      duration: 1,
      basePose: "relaxedRest",
      poses: {
        a: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
        b: { humanoid: { head: { rotation: [0, 0.2588, 0, 0.9659] } } },
      },
      poseKeyframes: [
        { time: 0, pose: "a" },
        { time: 1, pose: "b" },
      ],
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
