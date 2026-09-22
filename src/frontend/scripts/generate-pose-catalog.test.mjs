import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildPoseProjection,
  generatePoseCatalog,
} from "./generate-pose-catalog.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pose-projection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "poses");
  await mkdir(source);
  return { source, output: join(root, "projection.json") };
}

async function writePose(root, entry, overrides = {}) {
  const pose = {
    schema: "animaPose/1.0",
    id: entry,
    name: entry,
    humanoid: { hips: { rotation: [0, 0, 0, 1], position: [0, 0.1, 0] } },
    expressions: { happy: 0.5 },
  };
  const descriptor = {
    schema_version: 1,
    content_type: "pose",
    content_id: entry,
    name: entry,
    pose,
    ...overrides,
  };
  await mkdir(join(root, entry), { recursive: true });
  await writeFile(
    join(root, entry, `${entry}.json`),
    JSON.stringify(descriptor),
  );
  return descriptor;
}

test("projection preserves canonical values and orders entries deterministically", async (t) => {
  const { source } = await fixture(t);
  const z = await writePose(source, "z");
  const a = await writePose(source, "a");
  const first = await buildPoseProjection(source);
  assert.deepEqual(JSON.parse(first).poses, { a: a.pose, z: z.pose });
  assert.deepEqual(Object.keys(JSON.parse(first).poses), ["a", "z"]);
  assert.equal(await buildPoseProjection(source), first);
});

test("drift check rejects missing/stale output and never overwrites it", async (t) => {
  const { source, output } = await fixture(t);
  await writePose(source, "rest");
  await assert.rejects(
    generatePoseCatalog({ root: source, output }),
    /Pose projection drift/,
  );
  await generatePoseCatalog({ root: source, output, check: false });
  await generatePoseCatalog({ root: source, output });
  const previous = await readFile(output, "utf8");
  await writePose(source, "salute");
  await assert.rejects(
    generatePoseCatalog({ root: source, output }),
    /Pose projection drift/,
  );
  assert.equal(await readFile(output, "utf8"), previous);
  await generatePoseCatalog({ root: source, output, check: false });
  await generatePoseCatalog({ root: source, output });
  assert.notEqual(await readFile(output, "utf8"), previous);
});

test("projection rejects missing identity, parent inheritance and duplicate IDs", async (t) => {
  const { source } = await fixture(t);
  await writePose(source, "rest", { content_id: "other" });
  await assert.rejects(
    buildPoseProjection(source),
    /Invalid resolved Included Pose/,
  );
  const descriptor = await writePose(source, "rest");
  await writePose(source, "rest", {
    pose: { ...descriptor.pose, parent: { ref: "other" } },
  });
  await assert.rejects(
    buildPoseProjection(source),
    /Invalid resolved Included Pose/,
  );
  await writePose(source, "rest");
  await writePose(source, "copy", descriptor);
  await assert.rejects(
    buildPoseProjection(source),
    /Duplicate Included Pose id/,
  );
});
