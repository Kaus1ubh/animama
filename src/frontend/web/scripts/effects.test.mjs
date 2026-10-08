import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";

import { budgetForDefinition, summarizeCheck } from "./effect-check.mjs";
import {
  EffectPromoteError,
  applyEffectPromotion,
  parseEffectPromoteItems,
  planEffectPromotion,
  workingTreeRepo,
} from "./effect-promote.mjs";
import {
  definitionDifference,
  editorImage,
  parseEffectSaveItems,
  planEffectSave,
} from "./effect-save.mjs";

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-effects-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function disc(color = [230, 40, 60]) {
  const size = 64;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1)
      if ((x - 32) ** 2 + (y - 32) ** 2 <= 28 ** 2)
        data.set([...color, 255], (y * size + x) * 4);
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

const floating = (image = "art.png") => ({
  schema: "animama/avatar-effect/2",
  region: "emote",
  attachment: { kind: "face_landmark", landmark: "top", position: "middle" },
  art: { image },
});

test("art budgets follow the attachment", () => {
  assert.equal(budgetForDefinition(floating()).name, "landmark");
  assert.equal(
    budgetForDefinition({ attachment: { kind: "face_surface" }, art: {} }).name,
    "surface",
  );
  assert.equal(
    budgetForDefinition({
      attachment: { kind: "sticker" },
      art: { flipbook: { columns: 2 } },
    }).name,
    "flipbook",
  );
  assert.equal(
    budgetForDefinition({ attachment: { kind: "silhouette" }, art: {} }).maxKiB,
    512,
  );
});

test("check results become pass, warn and fail lines", () => {
  const tile = { width: 100, height: 100 };
  const avatar = (id, differingPixels, extra = {}) => ({
    id,
    applied: true,
    activeEffectIds: ["x"],
    warnings: [],
    missingPoseRefs: [],
    differingPixels,
    ...extra,
  });
  const lines = summarizeCheck({
    assets: [
      {
        file: "/drafts/x/art.png",
        issues: [{ level: "WARN", code: "padding", message: "wide margins" }],
      },
    ],
    page: {
      parseError: null,
      avatars: [
        avatar("AvatarSample_Y_0", [
          [50, 0],
          [80, 3],
        ]),
        avatar("AvatarSample_A_1_New", [
          [0, 0],
          [40, 0],
        ]),
      ],
    },
    times: [0.25, 1],
    views: ["front", "face"],
    tile,
  });
  assert.deepEqual(
    lines.map((line) => line.level),
    ["WARN", "PASS", "WARN"],
  );
  assert.match(lines[0].message, /^art art\.png: wide margins \[padding\]$/);
  assert.match(
    lines[1].message,
    /^Y_0: visible in 2 of 4 frames, up to 80 px \(front, 1s\)$/,
  );
  assert.match(lines[2].message, /nothing shows at 0\.25s/);

  const failing = summarizeCheck({
    assets: [],
    page: {
      parseError: null,
      avatars: [
        avatar("AvatarSample_Y_0", [[2]], { warnings: ["No eye_iris part"] }),
        avatar("AvatarSample_A_1_New", [[0]], {
          applied: false,
          activeEffectIds: [],
        }),
      ],
    },
    times: [1],
    views: ["front"],
    tile,
  });
  assert.deepEqual(
    failing.map((line) => `${line.level} ${line.message}`),
    [
      "FAIL Y_0: No eye_iris part",
      "FAIL Y_0: no visible art (at most 2 px changed; 10 needed; if it appears later, try --times)",
      "FAIL A_1_New: the effect is not active",
    ],
  );
  assert.deepEqual(
    summarizeCheck({
      assets: [],
      page: { parseError: "appearance.opacity: too big", avatars: [] },
      times: [1],
      views: ["front"],
      tile,
    }),
    [{ level: "FAIL", message: "definition: appearance.opacity: too big" }],
  );
});

test("save items resolve from the items file and need a source", () => {
  const items = parseEffectSaveItems(
    [{ source: "drop", name: " Sweat drop ", description: "Nervous." }],
    "/drafts/effects/items.json",
  );
  assert.deepEqual(items, [
    {
      source: "/drafts/effects/drop",
      name: "Sweat drop",
      description: "Nervous.",
    },
  ]);
  assert.throws(
    () => parseEffectSaveItems([], "items.json"),
    /non-empty array/,
  );
  assert.throws(() => parseEffectSaveItems([{}], "items.json"), /"source"/);
  assert.throws(
    () =>
      parseEffectSaveItems(
        [
          { source: "a", name: "Same" },
          { source: "b", name: "Same" },
        ],
        "items.json",
      ),
    /repeats/,
  );
});

test("a save revises the one Local effect with that name", () => {
  const library = [
    { item_id: "i1", source: "included", name: "Blush" },
    { item_id: "l1", source: "local", name: "Blush" },
    { item_id: "l2", source: "local", name: "Dup" },
    { item_id: "l3", source: "local", name: "Dup" },
  ];
  assert.deepEqual(planEffectSave("Blush", library), { itemId: "l1" });
  assert.equal(planEffectSave("New one", library), null);
  assert.throws(() => planEffectSave("Dup", library), /several Local/);
});

test("saved definitions compare after normalizing, ignoring image names", () => {
  const expected = floating("drop.png");
  const saved = {
    ...floating("drop-2.png"),
    appearance: null,
    art: { image: "drop-2.png", otherEyeImage: null, flipbook: null },
  };
  assert.equal(definitionDifference(saved, expected), null);
  const moved = {
    ...expected,
    attachment: { ...expected.attachment, position: "left" },
  };
  assert.match(
    definitionDifference(moved, expected),
    /^definition\.attachment\.position \(saved "left", expected "middle"\)$/,
  );
  // The normalizer sees both sides, so defaults it fills compare equal.
  const fill = (definition) => ({ appearance: { opacity: 1 }, ...definition });
  assert.equal(
    definitionDifference(
      { ...expected, appearance: { opacity: 1 } },
      expected,
      fill,
    ),
    null,
  );
});

test("editor image records carry type, size and digest", async () => {
  const file = path.join(dir, "art.png");
  await writeFile(file, await disc());
  const record = await editorImage(file);
  assert.equal(record.logicalName, "art.png");
  assert.equal(record.contentType, "image/png");
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  await writeFile(path.join(dir, "art.gif"), "GIF89a");
  await assert.rejects(
    editorImage(path.join(dir, "art.gif")),
    /PNG, JPEG or WebP/,
  );
});

test("promote items are validated", () => {
  const items = parseEffectPromoteItems(
    [
      {
        source: "library:local/Blush",
        stem: "blush",
        mode: "add",
        name: "Blush",
      },
      { stem: "eye_vv_pair", mode: "delete" },
    ],
    "items.json",
  );
  assert.equal(items[0].stem, "blush");
  assert.equal(items[1].source, undefined);
  for (const [item, message] of [
    [{ source: "x", stem: "Blush", mode: "add" }, /"stem"/],
    [{ source: "x", stem: "blush", mode: "move" }, /"mode"/],
    [{ stem: "blush", mode: "add" }, /"source"/],
    [{ source: "x", stem: "blush", mode: "delete" }, /no "source"/],
    [{ source: "x", stem: "eye", mode: "replace", name: "Eye 2" }, /keeps it/],
  ])
    assert.throws(() => parseEffectPromoteItems([item], "items.json"), message);
});

/** A small repository: two Included effects, licence files and a Gesture using one. */
async function fixtureRepo() {
  const root = await mkdtemp(path.join(dir, "repo-"));
  const effect = async (stem, image) => {
    const folder = path.join(root, "content/included/vfx/avatar", stem);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, image), await disc([10, 10, 200]));
    await writeFile(
      path.join(folder, `${stem}.json`),
      `${JSON.stringify(
        {
          schema_version: 1,
          content_type: "avatar_effect",
          content_id: `builtin:avatar-effect:${stem}`,
          version: 3,
          name: stem.toUpperCase(),
          description: `${stem} effect`,
          dependencies: [],
          definition: floating(image),
          files: [{ path: image, role: "image" }],
        },
        null,
        2,
      )}\n`,
    );
  };
  await effect("eye", "eye_r.png");
  await effect("old_pair", "pair.png");
  const gesture = path.join(root, "content/included/gestures/poke");
  await mkdir(gesture, { recursive: true });
  await writeFile(
    path.join(gesture, "poke.meta.json"),
    JSON.stringify({
      content_type: "gesture",
      dependencies: [{ ref: "builtin:avatar-effect:eye", alias: "eye" }],
    }),
  );
  await mkdir(path.join(root, "content/included/licenses"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "content/included/licenses/inventory.json"),
    JSON.stringify({ rules: [{ glob: "vfx/avatar/**/*" }, { glob: "**/*" }] }),
  );
  await mkdir(path.join(root, "licenses"));
  const record = {
    candidate_license: "L",
    basis: "B",
    copyright: "C",
    review: "R",
  };
  await writeFile(
    path.join(root, "licenses/source-review.json"),
    JSON.stringify({
      files: [
        "content/included/vfx/avatar/eye/eye.json",
        "content/included/vfx/avatar/eye/eye_r.png",
        "content/included/vfx/avatar/old_pair/old_pair.json",
        "content/included/vfx/avatar/old_pair/pair.png",
      ].map((file) => ({ path: file, ...record })),
    }),
  );
  return root;
}

async function source(stem, image, definition = floating(image)) {
  const folder = await mkdtemp(path.join(dir, `${stem}-`));
  const imagePath = path.join(folder, image);
  await writeFile(imagePath, await disc());
  return {
    stem,
    name: "Source name",
    description: "Source description",
    definition,
    imagePath,
    otherImagePath: null,
    dependencies: [],
  };
}

const validate = (definition) => {
  if (definition.schema !== "animama/avatar-effect/2")
    throw new Error("not /2");
};

test("promotion adds, replaces and deletes Included effects with records", async () => {
  const root = await fixtureRepo();
  const repo = workingTreeRepo(root);
  const changes = await planEffectPromotion(
    [
      {
        mode: "add",
        stem: "blush",
        name: "Blush",
        effect: await source("blush", "blush.png"),
      },
      {
        mode: "replace",
        stem: "eye",
        description: "Upgraded eye",
        effect: await source("eye", "eye_new.png"),
      },
      { mode: "delete", stem: "old_pair" },
    ],
    { repo, validate },
  );
  assert.deepEqual(
    changes.map((change) => `${change.action} ${change.path}`).sort(),
    [
      "create content/included/vfx/avatar/blush/blush.json",
      "create content/included/vfx/avatar/blush/blush.png",
      "create content/included/vfx/avatar/eye/eye_new.png",
      "delete content/included/vfx/avatar/eye/eye_r.png",
      "delete content/included/vfx/avatar/old_pair/old_pair.json",
      "delete content/included/vfx/avatar/old_pair/pair.png",
      "update content/included/vfx/avatar/eye/eye.json",
      "update licenses/source-review.json",
    ],
  );
  // Nothing is written until the changes are applied.
  assert.ok(
    (await readdir(path.join(root, "content/included/vfx/avatar"))).includes(
      "old_pair",
    ),
  );
  await applyEffectPromotion(root, changes);

  const read = async (relative) =>
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  const blush = await read("content/included/vfx/avatar/blush/blush.json");
  assert.equal(blush.content_id, "builtin:avatar-effect:blush");
  assert.equal(blush.name, "Blush");
  assert.equal(blush.description, "Source description");
  assert.deepEqual(blush.files, [{ path: "blush.png", role: "image" }]);
  const eye = await read("content/included/vfx/avatar/eye/eye.json");
  assert.equal(eye.content_id, "builtin:avatar-effect:eye");
  assert.equal(eye.version, 3);
  assert.equal(eye.name, "EYE");
  assert.equal(eye.description, "Upgraded eye");
  assert.equal(eye.definition.art.image, "eye_new.png");
  assert.deepEqual(
    (await readdir(path.join(root, "content/included/vfx/avatar"))).sort(),
    ["blush", "eye"],
  );
  const records = (await read("licenses/source-review.json")).files;
  assert.deepEqual(
    records.map((record) => record.path),
    [
      "content/included/vfx/avatar/blush/blush.json",
      "content/included/vfx/avatar/blush/blush.png",
      "content/included/vfx/avatar/eye/eye.json",
      "content/included/vfx/avatar/eye/eye_new.png",
    ],
  );
  assert.ok(
    records.every((record) => record.basis === "B" && record.review === "R"),
  );
  const reviewChange = changes.find(
    (change) => change.path === "licenses/source-review.json",
  );
  assert.ok(
    reviewChange.notes.includes(
      "record for content/included/vfx/avatar/blush/blush.png",
    ),
  );
  assert.ok(
    reviewChange.notes.includes(
      "no record for content/included/vfx/avatar/old_pair/pair.png",
    ),
  );
  // The licence inventory is untouched.
  assert.deepEqual(
    (await read("content/included/licenses/inventory.json")).rules.length,
    2,
  );
});

test("promotion refuses unsafe changes", async () => {
  const root = await fixtureRepo();
  const repo = workingTreeRepo(root);
  const plan = (items, options = {}) =>
    planEffectPromotion(items, { repo, validate, ...options });
  await assert.rejects(
    plan([{ mode: "delete", stem: "eye" }]),
    /still used by .*poke\.meta\.json/,
  );
  await assert.rejects(
    plan([{ mode: "delete", stem: "missing" }]),
    /no Included effect to delete/,
  );
  await assert.rejects(
    plan([{ mode: "add", stem: "eye", effect: await source("eye", "e.png") }]),
    /use mode "replace"/,
  );
  await assert.rejects(
    plan([
      { mode: "replace", stem: "nope", effect: await source("nope", "n.png") },
    ]),
    /no Included effect to replace/,
  );
  const withSound = await source("snd", "s.png");
  withSound.dependencies = [{ ref: "local:sound:x" }];
  await assert.rejects(
    plan([{ mode: "add", stem: "snd", effect: withSound }]),
    /sound or other dependencies/,
  );
  const soundAlias = await source("alias", "a.png", {
    ...floating("a.png"),
    soundAlias: "boing",
  });
  await assert.rejects(
    plan([{ mode: "add", stem: "alias", effect: soundAlias }]),
    /sound or other dependencies/,
  );
  for (const name of ["sub/x.png", "sub/../x.png", "..", "alias.json"]) {
    const unsafe = await source("named", "n.png", floating(name));
    await assert.rejects(
      plan([{ mode: "add", stem: "alias", effect: unsafe }]),
      /plain file name|named like the descriptor/,
      name,
    );
  }
  const twice = await source("twice", "t.png", {
    ...floating("t.png"),
    region: "eyes",
    attachment: {
      kind: "face_landmark",
      landmark: "eyes",
      side: "right",
      mirror: true,
    },
    art: { image: "t.png", otherEyeImage: "t.png" },
  });
  twice.otherImagePath = twice.imagePath;
  await assert.rejects(
    plan([{ mode: "add", stem: "twice", effect: twice }]),
    /different files/,
  );
  await assert.rejects(
    plan([
      {
        mode: "add",
        stem: "bad",
        effect: await source("bad", "b.png", {
          ...floating("b.png"),
          schema: "x",
        }),
      },
    ]),
    (error) =>
      error instanceof EffectPromoteError && /not \/2/.test(error.message),
  );
  const opaque = await source("solid", "solid.png");
  await writeFile(
    opaque.imagePath,
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer(),
  );
  await assert.rejects(
    plan([{ mode: "add", stem: "solid", effect: opaque }]),
    /fails the art check/,
  );
});
