import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  localEntryName,
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
    /^Y_0: visible in 2 of 4 frames, up to 80 px \(front, 1s\) \(not in face 0\.25s, face 1s\)$/,
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

test("Local names follow the backend's entry-name rule", () => {
  assert.equal(localEntryName("Sweat Drop - dry run"), "sweat-drop---dry-run");
  assert.equal(localEntryName(" Eye_O v2 "), "eye-o-v2");
  for (const bad of [
    "Sweat Drop (dry run)",
    "-dash first",
    "",
    "x".repeat(121),
  ])
    assert.throws(() => localEntryName(bad), /not a valid Local name/, bad);
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
  // Defaults the API fills for fields the creator leaves out (a silhouette's
  // scroll and pattern scale, a sticker's anchor) are not differences.
  const silhouette = {
    ...expected,
    attachment: { kind: "silhouette", fill: "tint" },
  };
  assert.equal(
    definitionDifference(
      {
        ...silhouette,
        attachment: {
          ...silhouette.attachment,
          scroll: { x: 0, y: 0 },
          patternScale: 1,
        },
      },
      silhouette,
    ),
    null,
  );
  const sticker = { ...expected, attachment: { kind: "sticker", size: 0.12 } };
  assert.equal(
    definitionDifference(
      { ...sticker, attachment: { ...sticker.attachment, around: "head" } },
      sticker,
    ),
    null,
  );
  const flipbook = { columns: 2, rows: 2, frames: 4, fps: 8 };
  const animated = { ...expected, art: { image: "drop.png", flipbook } };
  assert.equal(
    definitionDifference(
      {
        ...animated,
        art: { ...animated.art, flipbook: { ...flipbook, loop: "loop" } },
      },
      animated,
    ),
    null,
  );
  // A default on one side against another value is reported as that value.
  assert.match(
    definitionDifference(
      { ...sticker, attachment: { ...sticker.attachment, around: "head" } },
      { ...sticker, attachment: { ...sticker.attachment, around: "body" } },
    ),
    /^definition\.attachment\.around \(saved "head", expected "body"\)$/,
  );
  // A field the creator set must still match, and a value only the saved
  // item has is a change unless it is the API's default.
  assert.match(
    definitionDifference(
      { ...silhouette, attachment: { kind: "silhouette" } },
      silhouette,
    ),
    /^definition\.attachment\.fill \(saved undefined, expected "tint"\)$/,
  );
  assert.match(
    definitionDifference(
      {
        ...silhouette,
        attachment: { ...silhouette.attachment, scroll: { x: 0.5, y: 0 } },
      },
      silhouette,
    ),
    /^definition\.attachment\.scroll \(saved \{"x":0\.5,"y":0\}, expected undefined\)$/,
  );
  assert.match(
    definitionDifference(
      { ...expected, motion: { pulse: { scaleMax: 1.2 } } },
      expected,
    ),
    /^definition\.motion \(saved/,
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
        sound: "cute_chirpy_02",
      },
      { stem: "eye_vv_pair", mode: "delete" },
    ],
    "items.json",
  );
  assert.equal(items[0].stem, "blush");
  assert.equal(items[0].sound, "cute_chirpy_02");
  assert.equal(items[1].source, undefined);
  for (const [item, message] of [
    [{ source: "x", stem: "Blush", mode: "add" }, /"stem"/],
    [{ source: "x", stem: "blush", mode: "move" }, /"mode"/],
    [{ stem: "blush", mode: "add" }, /"source"/],
    [{ source: "x", stem: "blush", mode: "delete" }, /no "source"/],
    [{ source: "x", stem: "eye", mode: "replace", name: "Eye 2" }, /keeps it/],
    [{ stem: "eye", mode: "delete", sound: "pop" }, /"sound"/],
    [{ source: "x", stem: "eye", mode: "add", sound: "Pop!" }, /"sound"/],
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
  // "eye" already plays a licensed sound; a replace keeps it.
  const eyePath = path.join(root, "content/included/vfx/avatar/eye/eye.json");
  const eye = JSON.parse(await readFile(eyePath, "utf8"));
  eye.dependencies = [
    {
      ref: "builtin:sound-effect:pop",
      content_type: "sound_effect",
      alias: "on-apply",
      optional: true,
    },
  ];
  eye.definition.soundAlias = "on-apply";
  await writeFile(eyePath, `${JSON.stringify(eye, null, 2)}\n`);
  const resources = path.join(root, "src/backend/animama/resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    path.join(resources, "wow-comedy-sfx-manifest.json"),
    JSON.stringify({
      files: ["pop", "ding"].flatMap((key) => [
        { path: `sfx/wow-comedy/${key}.ogg` },
        { path: `sfx/wow-comedy/${key}.meta.json` },
      ]),
    }),
  );
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
    `${JSON.stringify(
      {
        files: [
          "content/included/vfx/avatar/eye/eye.json",
          "content/included/vfx/avatar/eye/eye_r.png",
          "content/included/vfx/avatar/old_pair/old_pair.json",
          "content/included/vfx/avatar/old_pair/pair.png",
        ].map((file) => ({ path: file, ...record })),
      },
      null,
      2,
    )}\n`,
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
        sound: "ding",
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
  assert.deepEqual(blush.dependencies, [
    {
      ref: "builtin:sound-effect:ding",
      content_type: "sound_effect",
      alias: "on-apply",
      optional: true,
    },
  ]);
  assert.equal(blush.definition.soundAlias, "on-apply");
  const eye = await read("content/included/vfx/avatar/eye/eye.json");
  assert.equal(eye.content_id, "builtin:avatar-effect:eye");
  assert.equal(eye.version, 3);
  assert.equal(eye.name, "EYE");
  assert.equal(eye.description, "Upgraded eye");
  assert.equal(eye.definition.art.image, "eye_new.png");
  // The replace kept the effect's licensed sound.
  assert.equal(eye.dependencies[0].ref, "builtin:sound-effect:pop");
  assert.equal(eye.definition.soundAlias, "on-apply");
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
    plan([
      {
        mode: "add",
        stem: "eye",
        sound: "pop",
        effect: await source("eye", "e.png"),
      },
    ]),
    /use mode "replace"/,
  );
  await assert.rejects(
    plan([{ mode: "add", stem: "new", effect: await source("new", "n.png") }]),
    /name one with "sound"/,
  );
  await assert.rejects(
    plan([
      {
        mode: "add",
        stem: "new",
        sound: "missing",
        effect: await source("new", "n.png"),
      },
    ]),
    /not a sound in the tracked comedy pack manifest/,
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
      plan([{ mode: "add", stem: "alias", sound: "pop", effect: unsafe }]),
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
    plan([{ mode: "add", stem: "twice", sound: "pop", effect: twice }]),
    /different files/,
  );
  await assert.rejects(
    plan([
      {
        mode: "add",
        stem: "bad",
        sound: "pop",
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
    plan([{ mode: "add", stem: "solid", sound: "pop", effect: opaque }]),
    /fails the art check/,
  );
});

test("Reaction and Gesture items replace one Included item from a project", () => {
  const [reaction, gesture] = parseEffectPromoteItems(
    [
      {
        kind: "reaction",
        stem: "joy-2",
        source: "../actions/joy-2.json",
        mode: "replace",
      },
      { kind: "gesture", stem: "poke", source: "poke.json", mode: "replace" },
    ],
    "items.json",
  );
  assert.equal(reaction.kind, "reaction");
  assert.equal(gesture.kind, "gesture");
  // Effects keep their kind by default, and stems repeat only across kinds.
  assert.equal(
    parseEffectPromoteItems(
      [
        { stem: "joy-2", mode: "delete" },
        { kind: "reaction", stem: "joy-2", source: "j.json", mode: "replace" },
      ],
      "items.json",
    )[0].kind,
    "avatar_effect",
  );
  for (const [item, message] of [
    [{ kind: "pose", stem: "a", source: "a.json", mode: "replace" }, /"kind"/],
    [{ kind: "reaction", stem: "a", source: "a.json", mode: "add" }, /replace/],
    [{ kind: "reaction", stem: "a", mode: "replace" }, /"source"/],
    [
      {
        kind: "reaction",
        stem: "a",
        source: "a.json",
        mode: "replace",
        description: "new",
      },
      /keeps/,
    ],
  ])
    assert.throws(() => parseEffectPromoteItems([item], "items.json"), message);
});

/** Add a Reaction using `old_pair` and an Included particle to a fixture repo. */
async function addReaction(root) {
  const particle = path.join(root, "content/included/vfx/particle/sparkle");
  await mkdir(particle, { recursive: true });
  await writeFile(
    path.join(particle, "sparkle.json"),
    JSON.stringify({
      content_type: "particle_effect",
      content_id: "builtin:particle-effect:sparkle",
    }),
  );
  const folder = path.join(root, "content/included/reactions/joy-2");
  await mkdir(folder, { recursive: true });
  const clip = {
    schema: "animaPoseClip/2.0",
    id: "joy-2",
    name: "Joy Reaction 2",
    role: "reaction",
    duration: 0.2,
    playback: { lifetime: { kind: "whileInteractionPhase" } },
    beats: [{ id: "peak", time: 0 }],
    expressions: { happy: [{ v: 0.8, beat: "peak" }] },
    events: [
      { id: "pair", time: 0.1, kind: "avatar_vfx", effectId: "pair" },
      { id: "spark", time: 0, kind: "particle_vfx", effectId: "sparkle" },
    ],
  };
  await writeFile(path.join(folder, "joy-2.json"), `${JSON.stringify(clip)}\n`);
  const meta = {
    content_type: "reaction",
    content_id: "builtin:reaction:joy-2",
    version: 1,
    name: "Joy Reaction 2",
    placement_hint: { emotion: "joy", intensity: 2 },
    dependencies: [
      {
        ref: "builtin:avatar-effect:old_pair",
        alias: "pair",
        content_type: "avatar_effect",
        config: {},
      },
      {
        ref: "builtin:particle-effect:sparkle",
        alias: "sparkle",
        content_type: "particle_effect",
        config: {},
      },
    ],
    files: [{ path: "joy-2.json", role: "sequence" }],
  };
  await writeFile(
    path.join(folder, "joy-2.meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  const reviewPath = path.join(root, "licenses/source-review.json");
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  for (const file of ["joy-2.json", "joy-2.meta.json"])
    review.files.push({
      path: `content/included/reactions/joy-2/${file}`,
      basis: "Reaction",
    });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return { clip, meta };
}

/** A creator project for `clip`, with dependencies as the creator writes them. */
const project = (clip, dependencies, intent = "reaction") => ({
  schema: "animamaActionProject/1.0",
  intent,
  name: clip.name,
  sequence: clip,
  dependencies: dependencies.map((dependency) => ({
    ...dependency,
    source: { type: "catalog", catalog_item_id: "item", source: "local" },
  })),
});

const validateClip = (clip) => {
  if (clip?.schema !== "animaPoseClip/2.0") throw new Error("not 2.0");
};

test("promotion replaces a Reaction and points it at the promoted effects", async () => {
  const root = await fixtureRepo();
  const { clip, meta } = await addReaction(root);
  const blush = await source("blush", "blush.png");
  blush.contentId = "local:avatar-effect:blush";
  const wired = {
    ...clip,
    events: [
      { id: "blush", time: 0.1, kind: "avatar_vfx", effectId: "blush" },
      clip.events[1],
    ],
  };
  const changes = await planEffectPromotion(
    [
      {
        kind: "avatar_effect",
        mode: "add",
        stem: "blush",
        sound: "pop",
        effect: blush,
      },
      { kind: "avatar_effect", mode: "delete", stem: "old_pair" },
      {
        kind: "reaction",
        mode: "replace",
        stem: "joy-2",
        project: project(wired, [
          {
            ref: "local:avatar-effect:blush",
            alias: "blush",
            content_type: "avatar_effect",
          },
          meta.dependencies[1],
        ]),
      },
    ],
    { repo: workingTreeRepo(root), validate, validateClip },
  );
  assert.ok(
    changes.some(
      (change) =>
        change.action === "delete" &&
        change.path === "content/included/vfx/avatar/old_pair/old_pair.json",
    ),
  );
  await applyEffectPromotion(root, changes);
  const folder = path.join(root, "content/included/reactions/joy-2");
  const clipText = await readFile(path.join(folder, "joy-2.json"), "utf8");
  assert.equal(clipText, `${JSON.stringify(wired)}\n`);
  const written = JSON.parse(
    await readFile(path.join(folder, "joy-2.meta.json"), "utf8"),
  );
  // The Included meta is kept; only its dependencies change, to Included refs.
  assert.deepEqual(written, {
    ...meta,
    dependencies: [
      {
        ref: "builtin:avatar-effect:blush",
        alias: "blush",
        content_type: "avatar_effect",
        config: {},
      },
      meta.dependencies[1],
    ],
  });
  // Reaction files keep their existing source-review records.
  const records = JSON.parse(
    await readFile(path.join(root, "licenses/source-review.json"), "utf8"),
  ).files.filter((record) => record.path.includes("reactions/"));
  assert.deepEqual(records, [
    { path: "content/included/reactions/joy-2/joy-2.json", basis: "Reaction" },
    {
      path: "content/included/reactions/joy-2/joy-2.meta.json",
      basis: "Reaction",
    },
  ]);

  // A project equal to the Included Reaction changes nothing.
  const again = await planEffectPromotion(
    [
      {
        kind: "reaction",
        mode: "replace",
        stem: "joy-2",
        project: project(wired, written.dependencies),
      },
    ],
    { repo: workingTreeRepo(root), validate, validateClip },
  );
  assert.deepEqual(
    again.map((change) => change.path),
    [],
  );
});

test("promotion refuses Reactions it cannot keep consistent", async () => {
  const root = await fixtureRepo();
  const { clip, meta } = await addReaction(root);
  const repo = workingTreeRepo(root);
  const plan = (items) =>
    planEffectPromotion(items, { repo, validate, validateClip });
  const replace = (sequence, dependencies = meta.dependencies, extra = {}) => ({
    kind: "reaction",
    mode: "replace",
    stem: "joy-2",
    project: project(sequence, dependencies),
    ...extra,
  });
  const local = {
    ref: "local:avatar-effect:blush",
    alias: "pair",
    content_type: "avatar_effect",
  };
  for (const [items, message] of [
    [[replace(clip, [local, meta.dependencies[1]])], /not Included content/],
    [
      [
        { kind: "avatar_effect", mode: "delete", stem: "old_pair" },
        replace(clip),
      ],
      /not Included content/,
    ],
    [
      [{ kind: "avatar_effect", mode: "delete", stem: "old_pair" }],
      /still used by .*joy-2\.meta\.json/,
    ],
    [[replace(clip, [meta.dependencies[1]])], /no dependency declares/],
    ...[
      { kind: "scene_vfx", presetId: "glow-bg" },
      { kind: "sfx", cueId: "tap" },
    ].map((event) => [
      [
        replace({
          ...clip,
          events: [...clip.events, { id: "x", time: 0, ...event }],
        }),
      ],
      /no dependency declares/,
    ]),
    [
      [
        replace(clip, [
          meta.dependencies[0],
          { ...meta.dependencies[1], content_type: "avatar_effect" },
        ]),
      ],
      /is a particle_effect/,
    ],
    ...[
      { rotations: { neck: [{ q: [0, 0, 0, 1] }] } },
      { joints: { rightShoulder: { elevation: [{ v: 10, beat: "peak" }] } } },
      { basePose: "relaxedRest" },
      { plantFeet: true },
    ].map((body) => [[replace({ ...clip, ...body })], /expression-only/]),
    [[replace({ ...clip, id: "joy-9" })], /keeps the Included clip's id/],
    [[replace({ ...clip, role: "gesture" })], /keeps the Included clip's role/],
    [[replace({ ...clip, schema: "animaPoseClip/1.0" })], /not 2\.0/],
    [
      [replace(clip, meta.dependencies, { stem: "joy-3" })],
      /no Included reaction/,
    ],
    [
      [
        {
          ...replace(clip),
          project: project(clip, meta.dependencies, "gesture"),
        },
      ],
      /gesture project/,
    ],
  ])
    await assert.rejects(plan(items), message);
});

test("promotion replaces a Gesture's effects and keeps its file's form", async () => {
  const root = await fixtureRepo();
  const folder = path.join(root, "content/included/gestures/wave");
  await mkdir(folder, { recursive: true });
  const clip = {
    schema: "animaPoseClip/2.0",
    id: "wave",
    name: "wave",
    duration: 1,
    loop: true,
    beats: [{ id: "a", time: 0 }],
    rotations: { neck: [{ q: [0, 0, 0, 1], beat: "a" }] },
    events: [{ id: "e", time: 0.3, kind: "avatar_vfx", effectId: "pair" }],
  };
  // An indented Gesture in its own style (here with inline arrays).
  const styled = `${JSON.stringify(clip, null, 2).replace(
    /\[\s+([-\d.,\s]+?)\s+\]/g,
    (_, numbers) => `[${numbers.split(/,\s*/).join(", ")}]`,
  )}\n`;
  assert.ok(styled.includes('"q": [0, 0, 0, 1]'));
  await writeFile(path.join(folder, "wave.json"), styled);
  const meta = {
    content_type: "gesture",
    content_id: "builtin:gesture:wave",
    dependencies: [
      {
        ref: "builtin:avatar-effect:old_pair",
        alias: "pair",
        content_type: "avatar_effect",
        config: {},
      },
    ],
    files: [{ path: "wave.json", role: "sequence" }],
  };
  await writeFile(
    path.join(folder, "wave.meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  const wired = {
    ...clip,
    events: [{ id: "e", time: 0.3, kind: "avatar_vfx", effectId: "eye" }],
  };
  const eyeDependency = {
    ref: "builtin:avatar-effect:eye",
    alias: "eye",
    content_type: "avatar_effect",
  };
  // Indented clips are written in the repository's JSON style.
  const formatJson = async (value) => `FORMATTED ${JSON.stringify(value)}\n`;
  const plan = (sequence, dependency = eyeDependency) =>
    planEffectPromotion(
      [
        ...(dependency === eyeDependency
          ? [{ kind: "avatar_effect", mode: "delete", stem: "old_pair" }]
          : []),
        {
          kind: "gesture",
          mode: "replace",
          stem: "wave",
          project: project(sequence, [dependency], "gesture"),
        },
      ],
      { repo: workingTreeRepo(root), validate, validateClip, formatJson },
    );
  // An unchanged Gesture writes nothing, whatever its file's style.
  assert.deepEqual(await plan(clip, meta.dependencies[0]), []);
  // A one-shot cannot become a loop, or the reverse.
  await assert.rejects(
    plan({ ...wired, loop: false }),
    /keeps the Included clip's loop/,
  );
  await applyEffectPromotion(root, await plan(wired));
  assert.equal(
    await readFile(path.join(folder, "wave.json"), "utf8"),
    `FORMATTED ${JSON.stringify(wired)}\n`,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(folder, "wave.meta.json"), "utf8"))
      .dependencies,
    [{ ...eyeDependency, config: {} }],
  );
});

test("render refuses two sources with one stem for directory output", async () => {
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "effect-render.mjs",
  );
  const sources = [];
  for (const parent of ["a", "b"]) {
    const folder = path.join(dir, "same-stem", parent, "drop");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "art.png"), await disc());
    await writeFile(
      path.join(folder, "drop.json"),
      JSON.stringify({ content_type: "avatar_effect", definition: floating() }),
    );
    sources.push(folder);
  }
  const result = await promisify(execFile)(process.execPath, [
    script,
    ...sources,
    "--out",
    path.join(dir, "same-stem", "out"),
  ]).catch((error) => error);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /share the stem "drop"/);
});
