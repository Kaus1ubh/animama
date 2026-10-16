import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { clipFileText, createTuneWriter } from "./content-tune-write.mjs";

const POP = "builtin:sound-effect:bubble_pop_01";
const DING = "builtin:sound-effect:ding_02";
const STAR = "builtin:avatar-effect:star3";

async function write(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function fixture(
  t,
  {
    compact = true,
    validateClip = () => ({ ok: true, issues: [] }),
    maxClipBytes = 1_000_000,
  } = {},
) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "tune-write-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(
    path.join(
      root,
      "src/backend/animama/resources/wow-comedy-sfx-manifest.json",
    ),
    JSON.stringify({ files: [{ path: "sfx/wow-comedy/bubble_pop_01.ogg" }] }),
  );
  await write(
    path.join(root, "src/backend/animama/resources/starter-idle-pool.v1.json"),
    JSON.stringify({ default: ["builtin:gesture:idle-sway"], cells: {} }),
  );
  const contentRoot = path.join(root, "content/included");
  const folder = path.join(contentRoot, "reactions/joy-2");
  const clip = {
    schema: "animaPoseClip/2.0",
    id: "joy-2",
    role: "reaction",
    duration: 3,
    beats: [{ id: "peak", label: "Peak", time: 0 }],
    expressions: { happy: [{ v: 0.5, beat: "peak" }] },
    events: [{ id: "star", time: 0.1, kind: "avatar_vfx", effectId: "star3" }],
  };
  const clipText = compact
    ? `${JSON.stringify(clip)}\n`
    : `${JSON.stringify(clip, null, 2)}\n`;
  await write(path.join(folder, "joy-2.json"), clipText);
  await write(
    path.join(folder, "joy-2.meta.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        content_type: "reaction",
        content_id: "builtin:reaction:joy-2",
        version: 1,
        name: "Joy Reaction 2",
        placement_hint: { emotion: "joy", intensity: 2 },
        implementation: { kind: "anima_clip", file_role: "sequence" },
        dependencies: [
          {
            ref: STAR,
            alias: "star3",
            content_type: "avatar_effect",
            config: {},
          },
        ],
        files: [{ path: "joy-2.json", role: "sequence" }],
      },
      null,
      2,
    )}\n`,
  );
  const writer = createTuneWriter({
    repoRoot: root,
    contentRoot,
    includedTypes: new Map([[STAR, "avatar_effect"]]),
    packSounds: new Set([POP, DING]),
    validateClip,
    maxClipBytes,
    formatJson: async (value) => `${JSON.stringify(value, null, 2)}\n`,
  });
  return { root, folder, writer };
}

test("saves an edit, keeping the compact clip form", async (t) => {
  const { folder, writer } = await fixture(t);
  const item = await writer.find("reaction", "joy-2");
  const saved = await writer.save({
    kind: "reaction",
    stem: "joy-2",
    revision: item.revision,
    events: [
      { id: "star", time: 0.1, kind: "avatar_vfx", effectId: "star3" },
      { id: "ding", time: 0.5, kind: "sfx", cueId: "ding" },
    ],
    expressions: { happy: [{ v: 0.9, beat: "peak" }] },
    dependencies: [
      ...item.dependencies,
      { ref: DING, alias: "ding", content_type: "sound_effect" },
    ],
  });

  const clipText = await readFile(path.join(folder, "joy-2.json"), "utf8");
  assert.equal(clipText.trimEnd().includes("\n"), false);
  assert.deepEqual(JSON.parse(clipText).expressions.happy, [
    { v: 0.9, beat: "peak" },
  ]);
  const meta = JSON.parse(
    await readFile(path.join(folder, "joy-2.meta.json"), "utf8"),
  );
  assert.deepEqual(meta.dependencies.at(-1), {
    ref: DING,
    alias: "ding",
    content_type: "sound_effect",
    config: {},
    optional: true,
  });
  assert.deepEqual(saved.pendingSounds, [DING]);
  assert.equal(saved.rebaseline, null);
  assert.notEqual(saved.item.revision, item.revision);
  // The pack needs ding added; nothing plays the shipped bubble pop.
  assert.deepEqual(await writer.pending(), {
    additions: [DING],
    removals: [POP],
  });
});

test("refuses a stale revision and writes nothing", async (t) => {
  const { folder, writer } = await fixture(t);
  const before = await readFile(path.join(folder, "joy-2.json"), "utf8");
  await assert.rejects(
    writer.save({
      kind: "reaction",
      stem: "joy-2",
      revision: "stale",
      events: [],
      dependencies: [],
    }),
    /changed on disk/,
  );
  await assert.rejects(
    writer.save({ kind: "pose", stem: "joy-2", revision: "x" }),
    /Unknown item kind/,
  );
  await assert.rejects(
    writer.save({ kind: "reaction", stem: "../joy-2", revision: "x" }),
    /Unknown item/,
  );
  await assert.rejects(
    writer.save({ kind: "reaction", stem: "joy-9", revision: "x" }),
    /No Included reaction/,
  );
  assert.equal(await readFile(path.join(folder, "joy-2.json"), "utf8"), before);
});

test("keeps unchanged bytes and an indented file's form", async () => {
  const value = { a: 1, b: [1, 2] };
  const indented = `${JSON.stringify(value, null, 2)}\n`;
  const format = async (next) => `${JSON.stringify(next, null, 2)}\n`;
  assert.equal(await clipFileText(value, indented, format), indented);
  assert.equal(
    await clipFileText({ ...value, a: 2 }, indented, format),
    `${JSON.stringify({ ...value, a: 2 }, null, 2)}\n`,
  );
  assert.equal(
    await clipFileText(
      { ...value, a: 2 },
      `${JSON.stringify(value)}\n`,
      format,
    ),
    `${JSON.stringify({ ...value, a: 2 })}\n`,
  );
});

test("refuses an invalid or oversized clip and writes nothing", async (t) => {
  for (const options of [
    {
      validateClip: () => ({
        ok: false,
        issues: [{ path: "events[0].time", message: "must be a number" }],
      }),
    },
    { maxClipBytes: 10 },
  ]) {
    const { folder, writer } = await fixture(t, options);
    const before = await readFile(path.join(folder, "joy-2.json"), "utf8");
    const item = await writer.find("reaction", "joy-2");
    await assert.rejects(
      writer.save({
        kind: "reaction",
        stem: "joy-2",
        revision: item.revision,
        events: [],
        expressions: { happy: [{ v: 0.2, beat: "peak" }] },
        dependencies: [],
      }),
      options.maxClipBytes ? /over the 10 the app loads/ : /events\[0\]\.time/,
    );
    assert.equal(
      await readFile(path.join(folder, "joy-2.json"), "utf8"),
      before,
    );
  }
});

test("saves several items together, or none when one is refused", async (t) => {
  const { folder, writer } = await fixture(t);
  // A second Reaction beside the first.
  const other = path.join(path.dirname(folder), "joy-3");
  await mkdir(other, { recursive: true });
  for (const name of ["joy-2.json", "joy-2.meta.json"]) {
    const text = (await readFile(path.join(folder, name), "utf8"))
      .replaceAll("joy-2", "joy-3")
      .replaceAll("Joy Reaction 2", "Joy Reaction 3");
    await writeFile(path.join(other, name.replace("joy-2", "joy-3")), text);
  }
  const first = await writer.find("reaction", "joy-2");
  const second = await writer.find("reaction", "joy-3");
  const peak = (item, v) => ({
    kind: "reaction",
    stem: item.stem,
    revision: item.revision,
    events: item.clip.events,
    expressions: { happy: [{ v, beat: "peak" }] },
    dependencies: item.dependencies,
  });
  const read = async (dir, stem) =>
    JSON.parse(await readFile(path.join(dir, `${stem}.json`), "utf8"))
      .expressions.happy[0].v;

  // One stale edit refuses the whole batch, naming the item.
  await assert.rejects(
    writer.saveAll([peak(first, 0.2), { ...peak(second, 0.3), revision: "x" }]),
    /Nothing was saved\. joy-3: .*changed on disk/,
  );
  assert.equal(await read(folder, "joy-2"), 0.5);
  await assert.rejects(
    writer.saveAll([peak(first, 0.2), peak(first, 0.3)]),
    /appears twice/,
  );
  await assert.rejects(writer.saveAll([]), /Nothing to save/);

  const saved = await writer.saveAll([peak(first, 0.2), peak(second, 0.3)]);
  assert.deepEqual(
    saved.items.map((item) => item.stem),
    ["joy-2", "joy-3"],
  );
  assert.equal(await read(folder, "joy-2"), 0.2);
  assert.equal(await read(other, "joy-3"), 0.3);
  assert.deepEqual(saved.rebaseline, []);
});

test("changes an Avatar Effect's sound together with item edits", async (t) => {
  const { root, folder, writer } = await fixture(t);
  const effectFolder = path.join(root, "content/included/vfx/avatar/star3");
  await mkdir(effectFolder, { recursive: true });
  const descriptor = {
    schema_version: 1,
    content_type: "avatar_effect",
    content_id: STAR,
    version: 1,
    name: "Star3",
    dependencies: [],
    definition: { schema: "animama/avatar-effect/2" },
  };
  await writeFile(
    path.join(effectFolder, "star3.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  const { loadTuneEffect } = await import("./content-tune-model.mjs");
  const effect = await loadTuneEffect(
    path.join(root, "content/included"),
    STAR,
  );
  const item = await writer.find("reaction", "joy-2");

  // A stale effect refuses the whole save.
  await assert.rejects(
    writer.saveAll([], [{ contentId: STAR, revision: "stale", sound: DING }]),
    /Nothing was saved\. builtin:avatar-effect:star3: .*changed on disk/,
  );
  const saved = await writer.saveAll(
    [
      {
        kind: "reaction",
        stem: "joy-2",
        revision: item.revision,
        events: item.clip.events,
        expressions: { happy: [{ v: 0.7, beat: "peak" }] },
        dependencies: item.dependencies,
      },
    ],
    [{ contentId: STAR, revision: effect.revision, sound: DING }],
  );
  const written = JSON.parse(
    await readFile(path.join(effectFolder, "star3.json"), "utf8"),
  );
  assert.deepEqual(written.dependencies, [
    {
      ref: DING,
      content_type: "sound_effect",
      alias: "on-apply",
      optional: true,
    },
  ]);
  assert.equal(written.definition.soundAlias, "on-apply");
  assert.deepEqual(saved.pendingSounds, [DING]);
  assert.equal(saved.effects[0].contentId, STAR);
  assert.equal(
    JSON.parse(await readFile(path.join(folder, "joy-2.json"), "utf8"))
      .expressions.happy[0].v,
    0.7,
  );
});

test("refuses an effect change that names no sound", async (t) => {
  const { root, writer } = await fixture(t);
  const folder = path.join(root, "content/included/vfx/avatar/star3");
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "star3.json"),
    `${JSON.stringify(
      {
        content_type: "avatar_effect",
        content_id: STAR,
        dependencies: [],
        definition: { schema: "animama/avatar-effect/2" },
      },
      null,
      2,
    )}\n`,
  );
  const { loadTuneEffect } = await import("./content-tune-model.mjs");
  const effect = await loadTuneEffect(
    path.join(root, "content/included"),
    STAR,
  );
  await assert.rejects(
    writer.saveAll([], [{ contentId: STAR, revision: effect.revision }]),
    /Name the effect's new sound/,
  );
});
