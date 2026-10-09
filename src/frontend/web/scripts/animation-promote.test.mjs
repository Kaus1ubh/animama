import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  PROMOTE_PATHS,
  parsePromoteItems,
  planPromotion,
} from "./animation-promote.mjs";

const licence = {
  creator: "Agent",
  provenance: "Agent-authored.",
  license_id: "LicenseRef-Animama-agent-authored",
  redistribution_review: "pending",
};
const sourceReview = {
  candidate_license: "AGPL-3.0-only",
  basis: "Agent-authored.",
  copyright: "2026 Owner",
  review: "prepared-not-release-approved",
};
const itemsFile = path.join("/work", "batch", "items.json");

function item(overrides = {}) {
  return {
    clip: "../drafts/wave-hello.clip.json",
    name: "Wave Hello",
    aiDescription: "A friendly wave.",
    selectorId: "wave_hello",
    mode: "add",
    licence,
    sourceReview,
    ...overrides,
  };
}

/** A clip validator stub: the real one is the motion CLI's compactClipFile. */
const compactClip = (clip) =>
  clip.invalid
    ? { ok: false, message: "Invalid animaPoseClip/2.0 (1 issue(s))" }
    : { ok: true, clip, saved: JSON.stringify(clip) };
const formatJson = async (value) => `${JSON.stringify(value)}\n`;
const maxClipBytes = 2 * 1024 * 1024;

const existingMeta = {
  schema_version: 1,
  content_type: "gesture",
  content_id: "builtin:gesture:arms-crossed",
  version: 1,
  semantic_key: "arms-crossed",
  name: "arms-crossed",
  ai_description: "Old.",
  implementation: { kind: "anima_clip", file_role: "sequence" },
  dependencies: [],
  files: [{ path: "arms-crossed.json", role: "sequence" }],
};

/** An in-memory repository with one Included Gesture. */
function fakeRepo() {
  const files = {
    [PROMOTE_PATHS.inventory]: JSON.stringify({
      schema_version: 1,
      rules: [
        { glob: "poses/**/*.json" },
        { glob: "gestures/**/*.json" },
        { glob: "gestures/**/*.vrma" },
      ],
    }),
    [PROMOTE_PATHS.sourceReview]: JSON.stringify({
      files: [
        { path: "content/included/gestures/arms-crossed/arms-crossed.json" },
        { path: "z.txt" },
      ],
    }),
    "content/included/gestures/arms-crossed/arms-crossed.meta.json":
      JSON.stringify(existingMeta),
    "content/included/gestures/arms-crossed/arms-crossed.json": JSON.stringify({
      schema: "animaPoseClip/2.0",
      loop: true,
    }),
  };
  return {
    files,
    read: (relative) => files[relative] ?? null,
    gestureSlugs: () => ["arms-crossed"],
  };
}

async function clipFile(name, clip) {
  const directory = await mkdtemp(path.join(tmpdir(), "promote-"));
  const file = path.join(directory, name);
  await writeFile(file, JSON.stringify(clip));
  return file;
}

const byPath = (writes) =>
  Object.fromEntries(writes.map((write) => [write.path, write]));

test("derives the slug from the clip file and requires mode and licence fields", async () => {
  const [parsed] = await parsePromoteItems([item()], itemsFile);
  assert.equal(parsed.slug, "wave-hello");
  assert.equal(
    parsed.clip,
    path.join("/work", "drafts", "wave-hello.clip.json"),
  );
  await assert.rejects(
    parsePromoteItems([item({ mode: undefined })], itemsFile),
    /"mode" must be "add" or "replace"/,
  );
  await assert.rejects(
    parsePromoteItems(
      [item({ licence: { ...licence, provenance: " " } })],
      itemsFile,
    ),
    /"licence".provenance must be a non-empty string/,
  );
  await assert.rejects(
    parsePromoteItems([item({ sourceReview: undefined })], itemsFile),
    /"sourceReview" must be an object/,
  );
  await assert.rejects(
    parsePromoteItems([item(), item({ selectorId: "other" })], itemsFile),
    /slug "wave-hello" repeats/,
  );
});

test("resolves Library sources to the saved item's file and folder name", async () => {
  const local = path.join("/stack", "content", "local", "gestures");
  const resolveClip = async (spec) => {
    if (spec === "library:local/wave_hello")
      return path.join(local, "wave-hello", "wave-hello.json");
    throw new Error(`No Library item matches ${spec}.`);
  };
  const [parsed] = await parsePromoteItems(
    [item({ clip: "library:local/wave_hello" })],
    itemsFile,
    resolveClip,
  );
  assert.equal(parsed.clip, path.join(local, "wave-hello", "wave-hello.json"));
  assert.equal(parsed.slug, "wave-hello");
  await assert.rejects(
    parsePromoteItems(
      [item({ clip: "library:local/missing" })],
      itemsFile,
      resolveClip,
    ),
    /item 1: No Library item matches library:local\/missing/,
  );
});

test("adds a new Gesture with metadata, licence rule and records", async () => {
  const repo = fakeRepo();
  const clip = await clipFile("wave-hello.clip.json", {
    schema: "animaPoseClip/2.0",
    id: "draft",
    name: "Draft",
  });
  const writes = byPath(
    await planPromotion(await parsePromoteItems([item({ clip })], itemsFile), {
      repo,
      compactClip,
      formatJson,
      maxClipBytes,
    }),
  );
  const included = "content/included/gestures/wave-hello/wave-hello.json";
  const metaPath = "content/included/gestures/wave-hello/wave-hello.meta.json";
  assert.equal(writes[included].action, "create");
  // The clip takes the Included id and name.
  assert.deepEqual(JSON.parse(writes[included].content), {
    schema: "animaPoseClip/2.0",
    id: "wave-hello",
    name: "Wave Hello",
  });
  assert.deepEqual(JSON.parse(writes[metaPath].content), {
    ...existingMeta,
    content_id: "builtin:gesture:wave-hello",
    semantic_key: "wave_hello",
    name: "Wave Hello",
    ai_description: "A friendly wave.",
    files: [{ path: "wave-hello.json", role: "sequence" }],
  });
  const rules = JSON.parse(writes[PROMOTE_PATHS.inventory].content).rules;
  assert.deepEqual(
    rules.map((rule) => rule.glob),
    [
      "poses/**/*.json",
      "gestures/wave-hello/*.json",
      "gestures/**/*.json",
      "gestures/**/*.vrma",
    ],
  );
  assert.deepEqual(rules[1], {
    glob: "gestures/wave-hello/*.json",
    ...licence,
  });
  const records = JSON.parse(writes[PROMOTE_PATHS.sourceReview].content).files;
  assert.deepEqual(
    records.map((record) => record.path),
    [
      "content/included/gestures/arms-crossed/arms-crossed.json",
      included,
      metaPath,
      "z.txt",
    ],
  );
  assert.deepEqual(records[1], { path: included, ...sourceReview });
  // Only Included content is written: no frontend copy.
  assert.deepEqual(
    Object.keys(writes).sort(),
    [
      included,
      metaPath,
      PROMOTE_PATHS.inventory,
      PROMOTE_PATHS.sourceReview,
    ].sort(),
  );
});

test("replaces an Included Gesture in place, keeping its identity and kind", async () => {
  const repo = fakeRepo();
  const clip = await clipFile("arms-crossed.clip.json", {
    schema: "animaPoseClip/2.0",
    loop: true,
  });
  const replace = item({
    clip,
    name: "arms-crossed",
    selectorId: "arms-crossed",
    aiDescription: "New.",
    description: "Crosses both arms.",
    mode: "replace",
  });
  const writes = byPath(
    await planPromotion(await parsePromoteItems([replace], itemsFile), {
      repo,
      compactClip,
      formatJson,
      maxClipBytes,
    }),
  );
  const metaPath =
    "content/included/gestures/arms-crossed/arms-crossed.meta.json";
  assert.equal(writes[metaPath].action, "update");
  assert.deepEqual(JSON.parse(writes[metaPath].content), {
    ...existingMeta,
    ai_description: "New.",
    description: "Crosses both arms.",
  });
  const plan = async (overrides) =>
    planPromotion(
      await parsePromoteItems([{ ...replace, ...overrides }], itemsFile),
      { repo, compactClip, formatJson, maxClipBytes },
    );
  await assert.rejects(plan({ selectorId: "arms-crossed-v2" }), /keeps it/);
  await assert.rejects(plan({ name: "Arms Crossed" }), /keeps its name/);
  await assert.rejects(
    plan({
      clip: await clipFile("arms-crossed.clip.json", { loop: false }),
    }),
    /must stay a loop/,
  );
  await assert.rejects(plan({ mode: "add" }), /use mode "replace"/);
  await assert.rejects(
    plan({ slug: "something-new", selectorId: "arms-crossed" }),
    /belongs to Included Gesture "arms-crossed"/,
  );
});

test("refuses an invalid clip and plans nothing new for a repeated run", async () => {
  const repo = fakeRepo();
  const invalid = await clipFile("wave-hello.clip.json", { invalid: true });
  await assert.rejects(
    planPromotion(
      await parsePromoteItems([item({ clip: invalid })], itemsFile),
      {
        repo,
        compactClip,
        formatJson,
        maxClipBytes,
      },
    ),
    /wave-hello: Invalid animaPoseClip\/2.0/,
  );
  const clip = await clipFile("wave-hello.clip.json", { schema: "x" });
  const items = await parsePromoteItems([item({ clip })], itemsFile);
  for (const write of await planPromotion(items, {
    repo,
    compactClip,
    formatJson,
    maxClipBytes,
  }))
    repo.files[write.path] = write.content;
  // A second run would replace, not add; as a replacement it changes nothing.
  assert.deepEqual(
    await planPromotion(
      await parsePromoteItems([item({ clip, mode: "replace" })], itemsFile),
      {
        repo: { ...repo, gestureSlugs: () => ["arms-crossed", "wave-hello"] },
        compactClip,
        formatJson,
        maxClipBytes,
      },
    ),
    [],
  );
  // The limit applies to the file as written.
  await assert.rejects(
    planPromotion(items, { repo, compactClip, formatJson, maxClipBytes: 10 }),
    /would be \d+ bytes, over the 10 the app loads/,
  );
});
