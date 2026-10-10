import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { diffImages, renderEffectThumbnails } from "./effect-render.mjs";
import {
  EffectSourceError,
  INCLUDED_CONTENT_ROOT,
} from "./effect-render-sources.mjs";
import {
  THUMBNAIL_DIR,
  WIDE_FRAMING_SCALE,
  selectTemplates,
  thumbnailJob,
} from "./effect-thumbnails.mjs";

const includedClip = async (slug) =>
  JSON.parse(
    await readFile(
      path.join(INCLUDED_CONTENT_ROOT, "gestures", slug, `${slug}.json`),
      "utf8",
    ),
  );

test("resolves a template's Included Gesture clip into its thumbnail job", async () => {
  const [posed, plain] = selectTemplates(["idea_bulb_fingertip", "eye_vv"]);
  assert.equal(posed.thumbnail?.clip, "have-an-idea");

  const job = await thumbnailJob(posed);
  assert.equal(job.effect.stem, "idea_bulb_fingertip");
  assert.deepEqual(job.clip, await includedClip("have-an-idea"));
  assert.equal(job.time, posed.thumbnail.time);
  assert.equal(job.framingScale, WIDE_FRAMING_SCALE);
  assert.equal(
    job.outFile,
    path.join(THUMBNAIL_DIR, "idea_bulb_fingertip.webp"),
  );

  const rest = await thumbnailJob(plain);
  assert.equal(rest.clip, null);
  assert.equal(rest.time, undefined);
  assert.equal(rest.framingScale, 1);

  await assert.rejects(
    thumbnailJob({ ...posed, thumbnail: { clip: "no-such-gesture" } }),
    (error) =>
      error instanceof EffectSourceError &&
      /No gesture matches "library:included\/no-such-gesture"/.test(
        error.message,
      ),
  );
});

// A real WebGL batch: the clip reaches the renderer and poses Annie, so the
// same effect and moment render differently with and without it.
test("poses Annie with the job's clip in a thumbnail batch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-thumbs-"));
  try {
    const [template] = selectTemplates(["idea_bulb_fingertip"]);
    const job = await thumbnailJob(template);
    const posedFile = path.join(dir, "posed.webp");
    const restFile = path.join(dir, "rest.webp");
    const results = await renderEffectThumbnails({
      jobs: [
        { ...job, outFile: posedFile },
        { ...job, clip: null, outFile: restFile },
      ],
      size: 256,
    });

    for (const result of results) {
      assert.deepEqual(result.failures, [], result.outFile);
      assert.deepEqual(result.avatars[0].missingPoseRefs, []);
      assert.equal(result.avatars[0].activeEffectIds.length, 1);
    }
    const difference = await diffImages(posedFile, restFile);
    assert.ok(
      difference.differingShare > 0.05,
      `posed and rest thumbnails differ in only ${difference.differingPixels} pixels`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
