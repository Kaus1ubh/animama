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

import {
  budgetForDefinition,
  builtInTextureCollisions,
  particleTextureBudgets,
  sceneImageLines,
  summarizeCheck,
} from "./effect-check.mjs";
import {
  EffectPromoteError,
  applyEffectPromotion,
  parseEffectPromoteItems,
  planEffectPromotion,
  workingTreeRepo,
} from "./effect-promote.mjs";
import {
  INCLUDED_CONTENT_ROOT,
  resolveAnyEffectSource,
} from "./effect-render-sources.mjs";
import {
  definitionDifference,
  editorImage,
  importDocumentFor,
  localEntryName,
  parseEffectSaveItems,
  planEffectSave,
  savedDifference,
  savedFilesDifference,
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
      { file: "/drafts/x/clean.png", budget: "scene-sticker", issues: [] },
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
    ["WARN", "PASS", "PASS", "WARN"],
  );
  assert.match(lines[0].message, /^art art\.png: wide margins \[padding\]$/);
  // Clean art says so, so the summary shows the art was checked.
  assert.equal(
    lines[1].message,
    "art clean.png: within the scene-sticker budget",
  );
  lines.splice(1, 1);
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
  // Clip poses missing from the catalog are reported once per effect.
  assert.deepEqual(
    summarizeCheck({
      assets: [],
      page: {
        parseError: null,
        avatars: [
          avatar("AvatarSample_Y_0", [[50]], { missingPoseRefs: ["salute"] }),
          avatar("AvatarSample_A_1_New", [[50]], {
            missingPoseRefs: ["salute"],
          }),
        ],
      },
      times: [1],
      views: ["front"],
      tile,
    }).map((line) => `${line.level} ${line.message}`),
    [
      "PASS Y_0: visible in 1 of 1 frames, up to 50 px (front, 1s)",
      "PASS A_1_New: visible in 1 of 1 frames, up to 50 px (front, 1s)",
      "WARN clip poses not in the app catalog rendered as the base pose: salute",
    ],
  );
  // Bone-attached art checked arms down is pointed at --with-clip.
  assert.match(
    summarizeCheck({
      assets: [],
      page: {
        parseError: null,
        avatars: [avatar("AvatarSample_Y_0", [[0]])],
      },
      times: [1],
      views: ["front"],
      tile,
      suggestClip: true,
    })[0].message,
    /no visible art \(.*try --times; on a bone a Gesture moves, check it in that pose with --with-clip <gesture>\)$/,
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
  assert.throws(
    () => planEffectSave("Dup", library),
    /several Local Avatar Effects/,
  );
  assert.throws(
    () => planEffectSave("Dup", library, "Scene Effect"),
    /several Local Scene Effects/,
  );
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
  // Only the Scene creator takes SVG.
  const svg = path.join(dir, "art.svg");
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(
    (await editorImage(svg, { svg: true })).contentType,
    "image/svg+xml",
  );
  await assert.rejects(editorImage(svg), /PNG, JPEG or WebP/);
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
      { kind: "avatar_effect", mode: "add", stem: "blush", effect: blush },
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

test("a clean Scene definition and image list report a PASS line", () => {
  assert.deepEqual(
    sceneImageLines({
      listedImages: ["drop.png"],
      imagePaths: { "drop.png": "/x/drop.png" },
    }),
    [{ level: "PASS", message: "scene: 1 image shown and listed" }],
  );
});

test("holds a Particle texture to the sheet budget when an emitter tiles it", () => {
  const emitter = (material, uTileCount) => ({
    type: "ParticleEmitter",
    ps: { material, uTileCount, vTileCount: 1 },
  });
  const manifest = {
    materials: [
      { uuid: "m1", map: "t1" },
      { uuid: "m2", map: "t2" },
    ],
    textures: [
      { uuid: "t1", image: "i1" },
      { uuid: "t2", image: "i2" },
    ],
    images: [
      { uuid: "i1", url: "textures/glyph.png" },
      { uuid: "i2", url: "textures/sheet.png" },
    ],
    object: {
      type: "Group",
      children: [emitter("m1", 1), emitter("m2", 4)],
    },
  };
  assert.deepEqual(Object.fromEntries(particleTextureBudgets(manifest)), {
    "textures/glyph.png": "particle-texture",
    "textures/sheet.png": "particle-sheet",
  });
});

/** A minimal Quarks manifest whose one emitter draws `texture`. */
const quarksManifest = (texture) => ({
  metadata: { version: 4.6, type: "Object", generator: "test" },
  images: [{ uuid: "image-1", url: texture }],
  textures: [{ uuid: "texture-1", image: "image-1" }],
  materials: [{ uuid: "material-1", map: "texture-1" }],
  object: {
    type: "Group",
    children: [
      {
        type: "ParticleEmitter",
        name: "emitter-1",
        ps: { material: "material-1", uTileCount: 1, vTileCount: 1 },
      },
    ],
  },
});

const particleSlot = (label) => ({
  label,
  description: "Particle source",
  anchor: "head",
  duration_seconds: 1.2,
  max_particles: 64,
});

/** A saved Local Particle Effect folder, resolved as `effects promote` does. */
async function particleSource(stem, texture = "textures/glow.png") {
  const folder = path.join(await mkdtemp(path.join(dir, "particle-")), stem);
  await mkdir(path.join(folder, path.dirname(texture)), { recursive: true });
  await writeFile(path.join(folder, texture), await disc([250, 200, 40]));
  await writeFile(
    path.join(folder, "particle.json"),
    `${JSON.stringify(quarksManifest(texture))}\n`,
  );
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify({
      schema_version: 1,
      content_type: "particle_effect",
      id: `local:particle-effect:${stem}`,
      name: `${stem} source`,
      description: "Particle source",
      authoring: { tool: "particle_vfx_creator" },
      runtime_defaults: {
        schema_version: 1,
        runtime_id: "custom-particle-vfx",
        slots: { particle_vfx: particleSlot(`${stem} source`) },
      },
      files: [
        { path: "particle.json", role: "manifest" },
        { path: texture, role: "texture" },
      ],
    }),
  );
  return { ...(await resolveAnyEffectSource(folder)), dependencies: [] };
}

const backgroundDefinition = (image) => ({
  schema: "animama/scene-effect/1",
  kind: "background_layers",
  durationMs: 2000,
  marquee: {
    items: [{ id: "petal", kind: "image", image, label: "Petal" }],
  },
});

/** A saved Local Scene Effect folder, resolved as `effects promote` does. */
async function sceneSource(
  stem,
  { image = "petal.png", definition = backgroundDefinition(image) } = {},
) {
  const folder = path.join(await mkdtemp(path.join(dir, "scene-")), stem);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, image), await disc([255, 92, 147]));
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify({
      schema_version: 1,
      content_type: "scene_effect",
      id: `local:scene-effect:${stem}`,
      name: `${stem} source`,
      description: "Scene source",
      authoring: { schema: "animama/scene-effect-editor/1" },
      definition,
      files: [{ path: image, role: "image" }],
    }),
  );
  return { ...(await resolveAnyEffectSource(folder)), dependencies: [] };
}

const ownerRule = {
  creator: "Animama project owner",
  provenance: "The owner confirms they created the avatar-expression assets.",
  license_id: "LicenseRef-Animama-owner-authored",
  redistribution_review: "pending",
};

/**
 * `fixtureRepo` plus an Included Particle Effect (legacy art with a
 * third-party record), an Included Scene Effect a Reaction uses, and the
 * licence rules promotion writes around.
 */
async function effectKindsRepo() {
  const root = await fixtureRepo();
  const write = async (relative, content) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  };
  const spark = "content/included/vfx/particle/quark/old_spark";
  await write(`${spark}/textures/spark.png`, await disc());
  await write(
    `${spark}/particle.json`,
    JSON.stringify(quarksManifest("textures/spark.png")),
  );
  await write(
    `${spark}/old_spark.json`,
    `${JSON.stringify(
      {
        schema_version: 1,
        content_type: "particle_effect",
        content_id: "builtin:particle-effect:old_spark",
        version: 2,
        name: "Old spark",
        description: "Legacy spark",
        runtime_defaults: {
          schema_version: 1,
          runtime_id: "old_spark",
          slots: { particle_vfx: particleSlot("Old spark") },
        },
        files: [
          { path: "particle.json", role: "manifest" },
          { path: "textures/spark.png", role: "texture" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const bg = "content/included/vfx/scene/old_bg";
  await write(`${bg}/old.png`, await disc());
  await write(
    `${bg}/old_bg.json`,
    `${JSON.stringify(
      {
        schema_version: 1,
        content_type: "scene_effect",
        content_id: "builtin:scene-effect:background:old_bg",
        version: 4,
        name: "Old background",
        description: "Legacy background",
        dependencies: [],
        definition: backgroundDefinition("old.png"),
        files: [{ path: "old.png", role: "image" }],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    "content/included/reactions/cheer/cheer.meta.json",
    JSON.stringify({
      content_type: "reaction",
      dependencies: [
        { ref: "builtin:scene-effect:background:old_bg", alias: "bg" },
      ],
    }),
  );
  await write(
    "content/included/licenses/inventory.json",
    `${JSON.stringify(
      {
        rules: [
          { glob: "vfx/avatar/**/*", ...ownerRule },
          { glob: "vfx/particle/quark/**", license_id: "CC0-generated" },
          { glob: "vfx/scene/**/*.png", ...ownerRule },
          { glob: "**/*", license_id: "legacy" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const reviewPath = path.join(root, "licenses/source-review.json");
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  const owner = {
    candidate_license: "L",
    basis: "B",
    copyright: "C",
    review: "R",
  };
  review.files.push(
    { path: `${spark}/old_spark.json`, ...owner },
    { path: `${spark}/particle.json`, ...owner },
    {
      path: `${spark}/textures/spark.png`,
      candidate_license: "CC0-1.0",
      evidence: ["licenses/third-party/art-particles.json"],
    },
    { path: `${bg}/old_bg.json`, ...owner },
    { path: `${bg}/old.png`, ...owner },
  );
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return root;
}

test("promotion adds Particle and Scene Effects under owner-authored rules", async () => {
  const root = await effectKindsRepo();
  const glow = await particleSource("glow");
  const petals = await sceneSource("petals");
  const validated = [];
  const changes = await planEffectPromotion(
    [
      {
        kind: "particle_effect",
        mode: "add",
        stem: "glow",
        name: "Glow",
        effect: glow,
      },
      { kind: "scene_effect", mode: "add", stem: "petals", effect: petals },
    ],
    {
      repo: workingTreeRepo(root),
      validate,
      validateParticle: (effect) => validated.push(effect.stem),
      validateScene: (effect) => validated.push(effect.stem),
    },
  );
  assert.deepEqual(validated, ["glow", "petals"]);
  assert.deepEqual(
    changes.map((change) => `${change.action} ${change.path}`).sort(),
    [
      "create content/included/vfx/particle/quark/glow/glow.json",
      "create content/included/vfx/particle/quark/glow/particle.json",
      "create content/included/vfx/particle/quark/glow/textures/glow.png",
      "create content/included/vfx/scene/petals/petal.png",
      "create content/included/vfx/scene/petals/petals.json",
      "update content/included/licenses/inventory.json",
      "update licenses/source-review.json",
    ],
  );
  await applyEffectPromotion(root, changes);
  const read = async (relative) =>
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  const quark = "content/included/vfx/particle/quark/glow";
  // Included form: no authoring record, the stem as runtime id, and the
  // Library name and description as the runtime label.
  assert.deepEqual(await read(`${quark}/glow.json`), {
    schema_version: 1,
    content_type: "particle_effect",
    content_id: "builtin:particle-effect:glow",
    version: 1,
    name: "Glow",
    description: "Particle source",
    runtime_defaults: {
      schema_version: 1,
      runtime_id: "glow",
      slots: { particle_vfx: particleSlot("Glow") },
    },
    files: [
      { path: "particle.json", role: "manifest" },
      { path: "textures/glow.png", role: "texture" },
    ],
  });
  assert.equal(
    await readFile(path.join(root, quark, "particle.json"), "utf8"),
    await readFile(glow.manifestPath, "utf8"),
  );
  assert.deepEqual(
    await read("content/included/vfx/scene/petals/petals.json"),
    {
      schema_version: 1,
      content_type: "scene_effect",
      content_id: "builtin:scene-effect:background:petals",
      version: 1,
      name: "petals source",
      description: "Scene source",
      dependencies: [],
      definition: backgroundDefinition("petal.png"),
      files: [{ path: "petal.png", role: "image" }],
    },
  );
  // D1: a per-stem Particle rule ahead of the generated-art rule; Scene PNGs
  // fall to the existing owner-authored Scene rule.
  const rules = (await read("content/included/licenses/inventory.json")).rules;
  assert.deepEqual(
    rules.map((rule) => rule.glob),
    [
      "vfx/avatar/**/*",
      "vfx/particle/quark/glow/**",
      "vfx/particle/quark/**",
      "vfx/scene/**/*.png",
      "**/*",
    ],
  );
  assert.deepEqual(rules[1], {
    glob: "vfx/particle/quark/glow/**",
    ...ownerRule,
    provenance: "The owner confirms they created the particle-effect assets.",
  });
  const records = (await read("licenses/source-review.json")).files.filter(
    (record) => /\/(glow|petals)\//.test(record.path),
  );
  assert.deepEqual(
    records.map((record) => record.path),
    [
      `${quark}/glow.json`,
      `${quark}/particle.json`,
      `${quark}/textures/glow.png`,
      "content/included/vfx/scene/petals/petal.png",
      "content/included/vfx/scene/petals/petals.json",
    ],
  );
  assert.ok(records.every((record) => record.basis === "B"));
  const inventoryChange = changes.find((change) =>
    change.path.endsWith("inventory.json"),
  );
  assert.deepEqual(inventoryChange.notes, [
    "rule vfx/particle/quark/glow/** (owner-authored)",
  ]);
});

test("promotion replaces and deletes Particle and Scene Effects", async () => {
  const root = await effectKindsRepo();
  const repo = workingTreeRepo(root);
  const options = {
    repo,
    validate,
    validateParticle: () => {},
    validateScene: () => {},
  };
  const changes = await planEffectPromotion(
    [
      {
        kind: "particle_effect",
        mode: "replace",
        stem: "old_spark",
        description: "Brighter spark",
        effect: await particleSource("glow"),
      },
      {
        kind: "scene_effect",
        mode: "replace",
        stem: "old_bg",
        effect: await sceneSource("petals"),
      },
    ],
    options,
  );
  const spark = "content/included/vfx/particle/quark/old_spark";
  const bg = "content/included/vfx/scene/old_bg";
  assert.deepEqual(
    changes.map((change) => `${change.action} ${change.path}`).sort(),
    [
      `create ${spark}/textures/glow.png`,
      `create ${bg}/petal.png`,
      `delete ${spark}/textures/spark.png`,
      `delete ${bg}/old.png`,
      "update content/included/licenses/inventory.json",
      `update ${spark}/old_spark.json`,
      `update ${spark}/particle.json`,
      `update ${bg}/old_bg.json`,
      "update licenses/source-review.json",
    ],
  );
  const reviewChange = changes.find(
    (change) => change.path === "licenses/source-review.json",
  );
  assert.ok(
    reviewChange.notes.includes(
      `${spark}/textures/spark.png had a third-party record (licenses/third-party/art-particles.json); update that evidence`,
    ),
  );
  await applyEffectPromotion(root, changes);
  const read = async (relative) =>
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  // A replace keeps the content ID, version and name.
  const particle = await read(`${spark}/old_spark.json`);
  assert.equal(particle.content_id, "builtin:particle-effect:old_spark");
  assert.equal(particle.version, 2);
  assert.equal(particle.name, "Old spark");
  assert.equal(particle.description, "Brighter spark");
  assert.deepEqual(particle.runtime_defaults, {
    schema_version: 1,
    runtime_id: "old_spark",
    slots: {
      particle_vfx: {
        ...particleSlot("Old spark"),
        description: "Brighter spark",
      },
    },
  });
  const scene = await read(`${bg}/old_bg.json`);
  assert.equal(scene.content_id, "builtin:scene-effect:background:old_bg");
  assert.equal(scene.version, 4);
  assert.equal(scene.description, "Legacy background");
  assert.deepEqual(scene.definition, backgroundDefinition("petal.png"));
  assert.deepEqual(scene.files, [{ path: "petal.png", role: "image" }]);

  // The Particle Effect is deleted with its folder and its own rule.
  const removal = await planEffectPromotion(
    [{ kind: "particle_effect", mode: "delete", stem: "old_spark" }],
    options,
  );
  assert.deepEqual(
    removal.map((change) => `${change.action} ${change.path}`).sort(),
    [
      "delete content/included/vfx/particle/quark/old_spark/old_spark.json",
      "delete content/included/vfx/particle/quark/old_spark/particle.json",
      "delete content/included/vfx/particle/quark/old_spark/textures/glow.png",
      "update content/included/licenses/inventory.json",
      "update licenses/source-review.json",
    ],
  );
  await applyEffectPromotion(root, removal);
  assert.deepEqual(
    await readdir(path.join(root, "content/included/vfx/particle/quark")),
    [],
  );
  assert.ok(
    !(await read("content/included/licenses/inventory.json")).rules.some(
      (rule) => rule.glob.includes("old_spark"),
    ),
  );
  assert.ok(
    !(await read("licenses/source-review.json")).files.some((record) =>
      record.path.includes("old_spark"),
    ),
  );
});

test("promotion refuses unsafe Particle and Scene changes", async () => {
  const root = await effectKindsRepo();
  const plan = (items, options = {}) =>
    planEffectPromotion(items, {
      repo: workingTreeRepo(root),
      validate,
      validateParticle: () => {},
      validateScene: () => {},
      ...options,
    });
  await assert.rejects(
    plan([{ kind: "scene_effect", mode: "delete", stem: "old_bg" }]),
    /still used by .*cheer\.meta\.json/,
  );
  await assert.rejects(
    plan([
      {
        kind: "scene_effect",
        mode: "replace",
        stem: "old_bg",
        effect: await sceneSource("lines", {
          definition: { schema: "animama/scene-effect/1", kind: "focus_lines" },
        }),
      },
    ]),
    /keeps the Scene kind \(background_layers\)/,
  );
  await assert.rejects(
    plan([
      {
        kind: "particle_effect",
        mode: "add",
        stem: "petals",
        effect: await sceneSource("petals"),
      },
    ]),
    /is a Scene Effect, not a Particle Effect/,
  );
  await assert.rejects(
    plan([
      {
        kind: "scene_effect",
        mode: "add",
        stem: "vector",
        effect: await sceneSource("vector", { image: "petal.svg" }),
      },
    ]),
    /petal\.svg: Scene art is promoted as PNG/,
  );
  const sounding = await sceneSource("sounding");
  sounding.definition = { ...sounding.definition, soundAlias: "chime" };
  await assert.rejects(
    plan([
      { kind: "scene_effect", mode: "add", stem: "sounding", effect: sounding },
    ]),
    /sound or other dependencies/,
  );
  await assert.rejects(
    plan([
      {
        kind: "particle_effect",
        mode: "add",
        stem: "clash",
        effect: await particleSource("clash", "clash.json"),
      },
    ]),
    /cannot be named like the descriptor or manifest/,
  );
  const opaque = await particleSource("opaque");
  await writeFile(
    opaque.texturePaths[0],
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer(),
  );
  await assert.rejects(
    plan([
      { kind: "particle_effect", mode: "add", stem: "opaque", effect: opaque },
    ]),
    /opaque: glow\.png fails the art check/,
  );
  for (const [kind, effect, option] of [
    ["particle_effect", await particleSource("bad"), "validateParticle"],
    ["scene_effect", await sceneSource("bad"), "validateScene"],
  ])
    await assert.rejects(
      plan([{ kind, mode: "add", stem: "bad", effect }], {
        [option]: () => {
          throw new Error("over the limit");
        },
      }),
      (error) =>
        error instanceof EffectPromoteError &&
        error.message === "bad: over the limit",
    );
  // Scene art needs the owner-authored Scene rule (D1).
  const inventory = path.join(root, "content/included/licenses/inventory.json");
  const rules = JSON.parse(await readFile(inventory, "utf8")).rules;
  await writeFile(
    inventory,
    JSON.stringify({
      rules: rules.filter((rule) => rule.glob !== "vfx/scene/**/*.png"),
    }),
  );
  await assert.rejects(
    plan([
      {
        kind: "scene_effect",
        mode: "add",
        stem: "petals",
        effect: await sceneSource("petals"),
      },
    ]),
    /no "vfx\/scene\/\*\*\/\*\.png" rule/,
  );
});

test("promotion points a Reaction at promoted Particle and Scene Effects", async () => {
  const root = await effectKindsRepo();
  const { clip } = await addReaction(root);
  const glow = await particleSource("glow");
  const petals = await sceneSource("petals");
  const wired = {
    ...clip,
    events: [
      { id: "spark", time: 0, kind: "particle_vfx", effectId: "glow" },
      {
        id: "bg",
        time: 0,
        kind: "scene_vfx",
        presetId: "petals",
        sceneKind: "background_layers",
      },
    ],
  };
  const changes = await planEffectPromotion(
    [
      { kind: "particle_effect", mode: "add", stem: "glow", effect: glow },
      { kind: "scene_effect", mode: "add", stem: "petals", effect: petals },
      {
        kind: "reaction",
        mode: "replace",
        stem: "joy-2",
        project: project(wired, [
          {
            ref: glow.contentId,
            alias: "glow",
            content_type: "particle_effect",
          },
          {
            ref: petals.contentId,
            alias: "petals",
            content_type: "scene_effect",
          },
        ]),
      },
    ],
    {
      repo: workingTreeRepo(root),
      validate,
      validateClip,
      validateParticle: () => {},
      validateScene: () => {},
    },
  );
  const meta = JSON.parse(
    changes.find((change) => change.path.endsWith("joy-2.meta.json")).content,
  );
  assert.deepEqual(
    meta.dependencies.map((dependency) => dependency.ref),
    ["builtin:particle-effect:glow", "builtin:scene-effect:background:petals"],
  );
});

test("saved Particle and Scene items compare settings, effect and file bytes", () => {
  const same = (value) => value;
  assert.equal(
    savedDifference({ a: 1, b: null }, { a: 1 }, same, "settings"),
    null,
  );
  assert.equal(
    savedDifference({ a: 2 }, { a: 1 }, same, "settings"),
    "settings.a (saved 2, expected 1)",
  );
  // The creator's round trip sees both sides, so its defaults compare equal.
  assert.equal(
    savedDifference({ a: 1 }, {}, (value) => ({ a: 1, ...value }), "quarks"),
    null,
  );
  const files = [
    { role: "texture", logical_path: "textures/a.png", sha256: "x" },
    { role: "manifest", logical_path: "particle.json", sha256: "m" },
  ];
  assert.equal(
    savedFilesDifference(files, { "textures/a.png": "x" }, "texture"),
    null,
  );
  assert.equal(
    savedFilesDifference(files, { "textures/a.png": "y" }, "texture"),
    "texture textures/a.png holds other bytes than the source",
  );
  assert.equal(
    savedFilesDifference(files, { "textures/b.png": "x" }, "texture"),
    "texture textures/b.png is missing",
  );
  assert.equal(
    savedFilesDifference(files, {}, "texture"),
    "texture textures/a.png is not in the source",
  );
});

test("Particle and Scene import documents come from the creators' functions", async () => {
  const glow = await particleSource("glow");
  const catalogs = [];
  const particle = {
    createParticleVFXEditorDraftFromImport: (quarksJson, catalog) => {
      catalogs.push(catalog);
      return { quarksJson, catalog };
    },
    buildParticleVFXCreatorDocument: (draft) => ({
      settings: { label: draft.catalog.label },
      quarks: draft.quarksJson,
    }),
    missingParticleVFXTextureReferences: (draft) =>
      draft.quarksJson.images.map((image) => image.url),
    parseParticleVFXRuntimeConfig: (slot) => ({ defaultAnchor: slot.anchor }),
    PARTICLE_VFX_EDITOR_TEXTURES: [{ relativeUrl: "textures/heart.png" }],
  };
  const job = await importDocumentFor(glow, { name: "Glow" }, { particle });
  assert.equal(job.name, "Glow");
  assert.deepEqual(catalogs, [
    { defaultAnchor: "head", label: "Glow", description: "Particle source" },
  ]);
  assert.deepEqual(job.expected.settings, { label: "Glow" });
  // The creator asks for the textures it does not carry, by file name.
  assert.deepEqual(job.chosen, [
    { fileName: "glow.png", file: glow.texturePaths[0] },
  ]);
  assert.match(job.expected.files["textures/glow.png"], /^[0-9a-f]{64}$/);
  await assert.rejects(
    importDocumentFor(
      glow,
      {},
      {
        particle: {
          ...particle,
          missingParticleVFXTextureReferences: () => ["textures/other.png"],
        },
      },
    ),
    /draws textures\/other\.png, which the folder does not list/,
  );
  // An own texture named like a built-in one is refused before saving.
  await assert.rejects(
    importDocumentFor(
      await particleSource("clash", "textures/heart.png"),
      {},
      {
        particle,
      },
    ),
    /textures\/heart\.png is named like the creator's built-in textures/,
  );
  await assert.rejects(
    importDocumentFor(
      glow,
      {},
      {
        particle: {
          ...particle,
          createParticleVFXEditorDraftFromImport: (quarksJson, catalog) => ({
            quarksJson: { ...quarksJson, images: [] },
            catalog,
          }),
          missingParticleVFXTextureReferences: () => [],
        },
      },
    ),
    /lists textures\/glow\.png, which no image of the effect uses/,
  );

  const petals = await sceneSource("petals");
  const scene = {
    canonicalSceneEffectImageName: (name) => name,
    createSceneEffectDocumentFromDefinition: (args) => args,
    buildSceneEffectEditorExport: (document) => ({ document }),
    sceneEffectDefinition: (document) => document.definition,
  };
  const sceneJob = await importDocumentFor(petals, {}, { scene });
  assert.equal(sceneJob.name, "petals source");
  assert.deepEqual(
    [...sceneJob.exportDocument.document.images.keys()],
    ["petal.png"],
  );
  assert.deepEqual(Object.keys(sceneJob.expected.files), ["petal.png"]);
  await assert.rejects(
    importDocumentFor(
      petals,
      {},
      {
        scene: { ...scene, canonicalSceneEffectImageName: () => "petal-2.png" },
      },
    ),
    /rename the image petal\.png to petal-2\.png/,
  );
  petals.definition = { ...petals.definition, soundAlias: "chime" };
  await assert.rejects(
    importDocumentFor(petals, {}, { scene }),
    /saved by hand/,
  );
});

test("promotion keeps the record and licence of reused third-party art", async () => {
  const root = await effectKindsRepo();
  // The creator's built-in texture, as Included content and its records
  // already carry it: third-party art under its own licence rule.
  const builtIn =
    "content/included/vfx/particle/particle-vfx/textures/glow.png";
  await mkdir(path.dirname(path.join(root, builtIn)), { recursive: true });
  await writeFile(path.join(root, builtIn), await disc([250, 200, 40]));
  const inventoryPath = path.join(
    root,
    "content/included/licenses/inventory.json",
  );
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const builtInRule = {
    glob: "vfx/particle/particle-vfx/**",
    creator: "Kenney",
    provenance: "CC0 particle pack",
    license_id: "CC0-1.0",
    redistribution_review: "pending",
  };
  inventory.rules.splice(1, 0, builtInRule);
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  const reviewPath = path.join(root, "licenses/source-review.json");
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  const thirdParty = {
    candidate_license: "CC-BY-4.0",
    copyright: "CodeManu",
    evidence: ["licenses/third-party/art-particles.json"],
  };
  review.files.push({ path: builtIn, ...thirdParty });
  review.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  const options = {
    repo: workingTreeRepo(root),
    validate,
    validateParticle: () => {},
    validateScene: () => {},
  };
  // The Local effect saved the same bytes (the creator packages built-ins).
  const changes = await planEffectPromotion(
    [
      {
        kind: "particle_effect",
        mode: "add",
        stem: "glow",
        effect: await particleSource("glow"),
      },
    ],
    options,
  );
  await applyEffectPromotion(root, changes);
  const quark = "content/included/vfx/particle/quark/glow";
  const records = JSON.parse(await readFile(reviewPath, "utf8")).files;
  const record = (file) => records.find((entry) => entry.path === file);
  assert.deepEqual(record(`${quark}/textures/glow.png`), {
    path: `${quark}/textures/glow.png`,
    ...thirdParty,
  });
  assert.equal(record(`${quark}/glow.json`).basis, "B");
  const rules = JSON.parse(await readFile(inventoryPath, "utf8")).rules;
  // The copy keeps its source's terms, ahead of the effect's owner rule.
  assert.deepEqual(
    rules.slice(1, 5).map((rule) => rule.glob),
    [
      "vfx/particle/particle-vfx/**",
      "vfx/particle/quark/glow/textures/glow.png",
      "vfx/particle/quark/glow/**",
      "vfx/particle/quark/**",
    ],
  );
  assert.deepEqual(rules[2], {
    ...builtInRule,
    glob: "vfx/particle/quark/glow/textures/glow.png",
  });
  const notes = changes.flatMap((change) => change.notes ?? []);
  assert.ok(
    notes.includes(
      `record for ${quark}/textures/glow.png carried from ${builtIn}`,
    ),
  );
  assert.ok(
    notes.includes(
      `rule vfx/particle/quark/glow/textures/glow.png (carried from ${builtIn})`,
    ),
  );

  // Deleting the effect removes both of its rules.
  await applyEffectPromotion(
    root,
    await planEffectPromotion(
      [{ kind: "particle_effect", mode: "delete", stem: "glow" }],
      options,
    ),
  );
  assert.ok(
    !JSON.parse(await readFile(inventoryPath, "utf8")).rules.some((rule) =>
      rule.glob.includes("quark/glow"),
    ),
  );
});

test("promotion refuses Particle textures nested past what a delete can clear", async () => {
  // A delete removes a texture's own folder and the effect folder.
  const root = await effectKindsRepo();
  const deep = await particleSource("deep", "textures/a/b.png");
  await assert.rejects(
    planEffectPromotion(
      [{ kind: "particle_effect", mode: "add", stem: "deep", effect: deep }],
      {
        repo: workingTreeRepo(root),
        validate,
        validateParticle: () => {},
        validateScene: () => {},
      },
    ),
    /texture "textures\/a\/b\.png" must be a file name or one folder deep/,
  );
});

test("an own texture named like a built-in creator texture is found", async () => {
  const builtIns = new Set(["textures/heart.png", "textures/sparkle.png"]);
  // Different bytes under a built-in's name: the creator would save its own.
  const own = await particleSource("own", "textures/heart.png");
  assert.deepEqual(await builtInTextureCollisions(own, builtIns), [
    "textures/heart.png",
  ]);
  // The built-in's own bytes (an effect that copied it) are fine.
  const copied = await particleSource("copied", "textures/heart.png");
  await writeFile(
    copied.texturePaths[0],
    await readFile(
      path.join(
        INCLUDED_CONTENT_ROOT,
        "vfx/particle/particle-vfx/textures/heart.png",
      ),
    ),
  );
  assert.deepEqual(await builtInTextureCollisions(copied, builtIns), []);
  // Any other name is the effect's own.
  const named = await particleSource("named", "textures/glossy-heart.png");
  assert.deepEqual(await builtInTextureCollisions(named, builtIns), []);
});

test("check refuses a --with-clip Gesture it cannot find", async () => {
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "effects.mjs",
  );
  const folder = path.join(dir, "posed", "drop");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "art.png"), await disc());
  await writeFile(
    path.join(folder, "drop.json"),
    JSON.stringify({ content_type: "avatar_effect", definition: floating() }),
  );
  const missing = path.join(dir, "posed", "missing.clip.json");
  const result = await promisify(execFile)(process.execPath, [
    script,
    "check",
    folder,
    "--with-clip",
    missing,
  ]).catch((error) => error);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /missing\.clip\.json does not exist/);
  assert.match(result.stdout, /--with-clip <clip>/);
});
