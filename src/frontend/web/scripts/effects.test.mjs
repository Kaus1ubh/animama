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
  particleSourceLines,
  particleTextureBudgets,
  sceneImageLines,
  summarizeCheck,
} from "./effect-check.mjs";
import { loadWebModule } from "./effects.mjs";
import {
  EFFECT_PROMOTE_PATHS,
  EffectPromoteError,
  OWNER_SOURCE_REVIEW,
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
        avatar("Andrew", [
          [50, 0],
          [80, 3],
        ]),
        avatar("Annie", [
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
    /^Andrew: visible in 2 of 4 frames, up to 80 px \(front, 1s\) \(not in face 0\.25s, face 1s\)$/,
  );
  assert.match(lines[2].message, /nothing shows at 0\.25s/);

  const failing = summarizeCheck({
    assets: [],
    page: {
      parseError: null,
      avatars: [
        avatar("Andrew", [[2]], { warnings: ["No eye_iris part"] }),
        avatar("Annie", [[0]], {
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
      "FAIL Andrew: No eye_iris part",
      "FAIL Andrew: no visible art (at most 2 px changed; 10 needed; if it appears later, try --times)",
      "FAIL Annie: the effect is not active",
    ],
  );
  // Clip poses missing from the catalog are reported once per effect.
  assert.deepEqual(
    summarizeCheck({
      assets: [],
      page: {
        parseError: null,
        avatars: [
          avatar("Andrew", [[50]], { missingPoseRefs: ["salute"] }),
          avatar("Annie", [[50]], {
            missingPoseRefs: ["salute"],
          }),
        ],
      },
      times: [1],
      views: ["front"],
      tile,
    }).map((line) => `${line.level} ${line.message}`),
    [
      "PASS Andrew: visible in 1 of 1 frames, up to 50 px (front, 1s)",
      "PASS Annie: visible in 1 of 1 frames, up to 50 px (front, 1s)",
      "WARN clip poses not in the app catalog rendered as the base pose: salute",
    ],
  );
  // Bone-attached art checked arms down is pointed at --with-clip.
  assert.match(
    summarizeCheck({
      assets: [],
      page: {
        parseError: null,
        avatars: [avatar("Andrew", [[0]])],
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
  // "eye" already plays licensed sounds (a merged effect declares several);
  // a replace keeps them.
  const eyePath = path.join(root, "content/included/vfx/avatar/eye/eye.json");
  const eye = JSON.parse(await readFile(eyePath, "utf8"));
  eye.dependencies = [
    {
      ref: "builtin:sound-effect:pop",
      content_type: "sound_effect",
      alias: "on-apply",
      optional: true,
    },
    {
      ref: "builtin:sound-effect:ding",
      content_type: "sound_effect",
      alias: "ding",
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

test("a silent built-in effect is added or made silent with sound null", async () => {
  const root = await fixtureRepo();
  const repo = workingTreeRepo(root);
  const changes = await planEffectPromotion(
    [
      {
        mode: "add",
        stem: "quiet",
        name: "Quiet",
        sound: null,
        effect: await source("quiet", "quiet.png"),
      },
      {
        mode: "replace",
        stem: "eye",
        sound: null,
        effect: await source("eye", "eye_new.png"),
      },
    ],
    { repo, validate },
  );
  await applyEffectPromotion(root, changes);
  const read = async (relative) =>
    JSON.parse(await readFile(path.join(root, relative), "utf8"));
  for (const stem of ["quiet", "eye"]) {
    const effect = await read(
      `content/included/vfx/avatar/${stem}/${stem}.json`,
    );
    assert.deepEqual(effect.dependencies, []);
    assert.equal(effect.definition.soundAlias, undefined);
  }
  assert.equal(
    parseEffectPromoteItems(
      [{ source: "x", stem: "quiet", mode: "add", sound: null }],
      "items.json",
    )[0].sound,
    null,
  );
});

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
  // The replace kept the effect's licensed sounds.
  assert.deepEqual(
    eye.dependencies.map((edge) => edge.ref),
    ["builtin:sound-effect:pop", "builtin:sound-effect:ding"],
  );
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
  // Owner-authored files get the owner's record, whatever form the existing
  // effect records have.
  for (const record of records)
    assert.deepEqual(record, { path: record.path, ...OWNER_SOURCE_REVIEW });
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
    [{ kind: "gesture", stem: "a", source: "a.json", mode: "add" }, /replace/],
    [{ kind: "reaction", stem: "a", source: "a.json", mode: "delete" }, /adds/],
    [
      { kind: "reaction", stem: "a", source: "a.json", mode: "add" },
      /"placement_hint"/,
    ],
    [
      {
        kind: "reaction",
        stem: "a",
        source: "a.json",
        mode: "add",
        placement_hint: { emotion: "joy", intensity: 0 },
      },
      /"placement_hint"/,
    ],
    [
      {
        kind: "reaction",
        stem: "a",
        source: "a.json",
        mode: "replace",
        placement_hint: { emotion: "joy", intensity: 2 },
      },
      /keeps it/,
    ],
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

test("promotion adds a Reaction with its meta, records and Included refs", async () => {
  const root = await fixtureRepo();
  const { clip, meta } = await addReaction(root);
  const added = {
    ...clip,
    id: "joy-4-b",
    name: "Joy Reaction 4B",
    events: [
      { id: "spark", time: 0, kind: "particle_vfx", effectId: "sparkle" },
    ],
  };
  const item = {
    kind: "reaction",
    mode: "add",
    stem: "joy-4-b",
    placement_hint: { emotion: "joy", intensity: 4 },
    project: project(added, [meta.dependencies[1]]),
  };
  const repo = workingTreeRepo(root);
  const changes = await planEffectPromotion([item], {
    repo,
    validate,
    validateClip,
  });
  await applyEffectPromotion(root, changes);
  const folder = path.join(root, "content/included/reactions/joy-4-b");
  assert.equal(
    await readFile(path.join(folder, "joy-4-b.json"), "utf8"),
    `${JSON.stringify(added)}\n`,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(folder, "joy-4-b.meta.json"), "utf8")),
    {
      schema_version: 1,
      content_type: "reaction",
      content_id: "builtin:reaction:joy-4-b",
      version: 1,
      name: "Joy Reaction 4B",
      ai_description: "Reusable avatar reaction clip",
      placement_hint: { emotion: "joy", intensity: 4 },
      implementation: { kind: "anima_clip", file_role: "sequence" },
      dependencies: [meta.dependencies[1]],
      files: [{ path: "joy-4-b.json", role: "sequence" }],
    },
  );
  const records = JSON.parse(
    await readFile(path.join(root, "licenses/source-review.json"), "utf8"),
  ).files.filter((record) => record.path.includes("reactions/joy-4-b"));
  assert.deepEqual(records, [
    {
      path: "content/included/reactions/joy-4-b/joy-4-b.json",
      ...OWNER_SOURCE_REVIEW,
    },
    {
      path: "content/included/reactions/joy-4-b/joy-4-b.meta.json",
      ...OWNER_SOURCE_REVIEW,
    },
  ]);
  // A second add of the same stem is refused; it is a replace now.
  await assert.rejects(
    planEffectPromotion([item], { repo, validate, validateClip }),
    /use mode "replace"/,
  );
  await assert.rejects(
    planEffectPromotion(
      [{ ...item, stem: "joy-5", project: project(added, []) }],
      { repo, validate, validateClip },
    ),
    /clip id must be its stem/,
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
  for (const record of records)
    assert.deepEqual(record, { path: record.path, ...OWNER_SOURCE_REVIEW });
  const inventoryChange = changes.find((change) =>
    change.path.endsWith("inventory.json"),
  );
  assert.deepEqual(inventoryChange.notes, [
    "rule vfx/particle/quark/glow/** (owner-authored)",
  ]);
});

test("Particle promotion supports per-folder inventories and preserves copied art terms", async () => {
  const root = await effectKindsRepo();
  const inventoryPath = path.join(
    root,
    "content/included/licenses/inventory.json",
  );
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  // Current Included content licenses each Particle folder explicitly, without
  // a generated-art catch-all. Keep the old texture's distinct source terms.
  inventory.rules = inventory.rules.map((rule) =>
    rule.glob === "vfx/particle/quark/**"
      ? { glob: "vfx/particle/quark/old_spark/**", license_id: "CC0-1.0" }
      : rule,
  );
  const before = `${JSON.stringify(inventory, null, 2)}\n`;
  await writeFile(inventoryPath, before);
  const fresh = await particleSource("fresh");
  const copied = await particleSource("copied", "textures/spark.png");
  const origin =
    "content/included/vfx/particle/quark/old_spark/textures/spark.png";
  await writeFile(
    copied.texturePaths[0],
    await readFile(path.join(root, origin)),
  );
  const options = {
    repo: workingTreeRepo(root),
    validate,
    validateParticle: () => {},
  };
  const changes = await planEffectPromotion(
    [
      { kind: "particle_effect", mode: "add", stem: "fresh", effect: fresh },
      { kind: "particle_effect", mode: "add", stem: "copied", effect: copied },
    ],
    options,
  );
  assert.equal(await readFile(inventoryPath, "utf8"), before);
  await applyEffectPromotion(root, changes);
  const rules = JSON.parse(await readFile(inventoryPath, "utf8")).rules;
  const globs = rules.map((rule) => rule.glob);
  assert.ok(!globs.includes("vfx/particle/quark/**"));
  assert.deepEqual(
    rules.filter((rule) => !/quark\/(fresh|copied)\//.test(rule.glob)),
    inventory.rules,
  );
  for (const stem of ["fresh", "copied"]) {
    const glob = `vfx/particle/quark/${stem}/**`;
    assert.deepEqual(
      rules.find((rule) => rule.glob === glob),
      {
        glob,
        ...ownerRule,
        provenance:
          "The owner confirms they created the particle-effect assets.",
      },
    );
    assert.ok(globs.indexOf(glob) < globs.indexOf("**/*"));
  }
  const copy = "vfx/particle/quark/copied/textures/spark.png";
  assert.deepEqual(
    rules.find((rule) => rule.glob === copy),
    {
      glob: copy,
      license_id: "CC0-1.0",
    },
  );
  assert.ok(
    globs.indexOf(copy) < globs.indexOf("vfx/particle/quark/copied/**"),
  );
  const reviewPath = path.join(root, "licenses/source-review.json");
  const records = JSON.parse(await readFile(reviewPath, "utf8")).files;
  assert.deepEqual(
    records.find((record) => record.path === `content/included/${copy}`),
    {
      ...records.find((record) => record.path === origin),
      path: `content/included/${copy}`,
    },
  );

  await applyEffectPromotion(
    root,
    await planEffectPromotion(
      [{ kind: "particle_effect", mode: "delete", stem: "copied" }],
      options,
    ),
  );
  const remaining = JSON.parse(await readFile(inventoryPath, "utf8")).rules;
  assert.ok(!remaining.some((rule) => rule.glob.includes("quark/copied/")));
  assert.ok(
    remaining.some((rule) => rule.glob === "vfx/particle/quark/fresh/**"),
  );
  assert.ok(
    remaining.some((rule) => rule.glob === "vfx/particle/quark/old_spark/**"),
  );
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

// `effects save` and `promote` run the creators' own modules, which word
// their messages through the app's i18n. react-i18next's instance is shared by
// the process, so no earlier test in this file may create it.
test("the creators' modules load with English messages", async () => {
  const loader = await loadWebModule("/src/lib/scene-vfx/editor/document.ts");
  try {
    assert.equal(
      loader.module.sceneEffectFieldLabel("gradient.stops.0"),
      "Gradient stop 1",
    );
    const hearts = await resolveAnyEffectSource(
      path.join(INCLUDED_CONTENT_ROOT, "vfx/particle/quark/hearts-v1"),
    );
    const lines = await particleSourceLines(hearts, {
      ssrLoadModule: loader.load,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "PASS");
    assert.match(lines[0].message, /^particles: Save's estimate is up to \d+/);
  } finally {
    await loader.close();
  }
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
  assert.equal(record(`${quark}/glow.json`).basis, OWNER_SOURCE_REVIEW.basis);
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

/** An agent-authored licence and the record form its files get. */
const agentLicence = {
  creator: "Animama project; authored by an AI coding agent",
  provenance: "Agent-authored effect (#1).",
  license_id: "LicenseRef-Animama-agent-authored",
  redistribution_review: "pending",
};
const agentReview = (basis) => ({
  candidate_license: "AGPL-3.0-only",
  basis,
  copyright: "2026 Owner",
  review: "prepared",
});

/**
 * `effectKindsRepo` plus the joy-2 Reaction, an owner-authored sticker under
 * its own rule and an owner-authored general Reaction rule.
 */
async function licenceRepo() {
  const root = await effectKindsRepo();
  const reaction = await addReaction(root);
  const sticker = "content/included/resources/stickers/star.png";
  await mkdir(path.dirname(path.join(root, sticker)), { recursive: true });
  await writeFile(path.join(root, sticker), await disc([40, 160, 90]));
  const inventoryPath = path.join(
    root,
    "content/included/licenses/inventory.json",
  );
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const stickerRule = {
    glob: "resources/stickers/**",
    ...ownerRule,
    provenance: "The owner made the stickers.",
  };
  inventory.rules.splice(inventory.rules.length - 1, 0, stickerRule, {
    glob: "reactions/**/*",
    ...ownerRule,
    provenance: "The owner made the Reactions.",
  });
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  const reviewPath = path.join(root, "licenses/source-review.json");
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  const stickerRecord = {
    candidate_license: "L",
    basis: "Owner sticker",
    copyright: "C",
    review: "R",
  };
  review.files.push({ path: sticker, ...stickerRecord });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return {
    root,
    ...reaction,
    sticker,
    stickerRule,
    stickerRecord,
    inventoryPath,
    reviewPath,
  };
}

/** An Avatar Effect source whose art repeats no fixture file. */
async function ownArtSource(stem) {
  const effect = await source(stem, `${stem}.png`);
  await writeFile(effect.imagePath, await disc([90, 30, 200]));
  return effect;
}

/** A saved Local Scene Effect with its own art and a copy of `sticker`. */
async function stickerSceneSource(root, stem, sticker) {
  const folder = path.join(await mkdtemp(path.join(dir, "scene-")), stem);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "own.png"), await disc([255, 92, 147]));
  await writeFile(
    path.join(folder, "star.png"),
    await readFile(path.join(root, sticker)),
  );
  const definition = backgroundDefinition("own.png");
  definition.marquee.items.push({
    id: "star",
    kind: "image",
    image: "star.png",
    label: "Star",
  });
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify({
      schema_version: 1,
      content_type: "scene_effect",
      id: `local:scene-effect:${stem}`,
      name: `${stem} source`,
      description: "Scene source",
      definition,
      files: [
        { path: "own.png", role: "image" },
        { path: "star.png", role: "image" },
      ],
    }),
  );
  return { ...(await resolveAnyEffectSource(folder)), dependencies: [] };
}

test("promotion writes an item's licence entries as its rule and records", async () => {
  const fixture = await licenceRepo();
  const { root, clip, meta, sticker, stickerRule, stickerRecord } = fixture;
  const options = {
    repo: workingTreeRepo(root),
    validate,
    validateClip,
    validateParticle: () => {},
    validateScene: () => {},
  };
  const reactionLicence = {
    ...agentLicence,
    provenance: "Agent-written Reactions (#1).",
    glob: "reactions/**/*",
  };
  const added = {
    ...clip,
    id: "joy-4-b",
    name: "Joy Reaction 4B",
    events: [clip.events[1]],
  };
  const items = [
    {
      mode: "add",
      stem: "ink",
      sound: null,
      effect: await ownArtSource("ink"),
      licence: agentLicence,
      sourceReview: agentReview({ "ink.json": "Definition", "ink.png": "Art" }),
    },
    {
      kind: "particle_effect",
      mode: "add",
      stem: "spray",
      effect: await particleSource("spray"),
      licence: agentLicence,
      sourceReview: agentReview("Particle"),
    },
    {
      kind: "scene_effect",
      mode: "add",
      stem: "stage",
      effect: await stickerSceneSource(root, "stage", sticker),
      licence: agentLicence,
      // The reused sticker keeps its own record, so it has no basis here.
      sourceReview: agentReview({
        "stage.json": "Scene definition",
        "own.png": "Scene art",
      }),
    },
    {
      kind: "reaction",
      mode: "add",
      stem: "joy-4-b",
      placement_hint: { emotion: "joy", intensity: 4 },
      project: project(added, [meta.dependencies[1]]),
      licence: reactionLicence,
      sourceReview: agentReview({
        "joy-4-b.json": "Clip",
        "joy-4-b.meta.json": "Meta",
      }),
    },
    {
      // An unchanged replace still takes its new records.
      kind: "reaction",
      mode: "replace",
      stem: "joy-2",
      project: project(clip, meta.dependencies),
      licence: reactionLicence,
      sourceReview: agentReview("Clip and meta"),
    },
  ];
  const changes = await planEffectPromotion(items, options);
  // The unchanged Reaction's files are not rewritten.
  assert.ok(!changes.some((change) => change.path.includes("/joy-2/")));
  await applyEffectPromotion(root, changes);
  const rules = JSON.parse(await readFile(fixture.inventoryPath, "utf8")).rules;
  const globs = rules.map((rule) => rule.glob);
  // Each item's rule goes ahead of its kind's general rule; the shared
  // Reaction rule replaces the general one in place; the reused sticker keeps
  // its terms ahead of the Scene's own rule.
  assert.deepEqual(globs, [
    "vfx/avatar/ink/**",
    "vfx/avatar/**/*",
    "vfx/particle/quark/spray/**",
    "vfx/particle/quark/**",
    "vfx/scene/stage/star.png",
    "vfx/scene/stage/**",
    "vfx/scene/**/*.png",
    "resources/stickers/**",
    "reactions/**/*",
    "**/*",
  ]);
  const rule = (glob) => rules.find((entry) => entry.glob === glob);
  assert.deepEqual(rule("vfx/avatar/ink/**"), {
    glob: "vfx/avatar/ink/**",
    ...agentLicence,
  });
  assert.deepEqual(rule("vfx/scene/stage/star.png"), {
    ...stickerRule,
    glob: "vfx/scene/stage/star.png",
  });
  assert.deepEqual(rule("reactions/**/*"), reactionLicence);
  const records = new Map(
    JSON.parse(await readFile(fixture.reviewPath, "utf8")).files.map(
      ({ path: file, ...record }) => [file, record],
    ),
  );
  const included = "content/included";
  for (const [file, basis] of [
    ["vfx/avatar/ink/ink.json", "Definition"],
    ["vfx/avatar/ink/ink.png", "Art"],
    ["vfx/particle/quark/spray/spray.json", "Particle"],
    ["vfx/particle/quark/spray/particle.json", "Particle"],
    ["vfx/particle/quark/spray/textures/glow.png", "Particle"],
    ["vfx/scene/stage/stage.json", "Scene definition"],
    ["vfx/scene/stage/own.png", "Scene art"],
    ["reactions/joy-4-b/joy-4-b.json", "Clip"],
    ["reactions/joy-4-b/joy-4-b.meta.json", "Meta"],
    ["reactions/joy-2/joy-2.json", "Clip and meta"],
    ["reactions/joy-2/joy-2.meta.json", "Clip and meta"],
  ])
    assert.deepEqual(
      records.get(`${included}/${file}`),
      agentReview(basis),
      file,
    );
  assert.deepEqual(
    records.get(`${included}/vfx/scene/stage/star.png`),
    stickerRecord,
  );
  const notes = changes.flatMap((change) => change.notes ?? []);
  assert.ok(
    notes.includes(
      `record for ${included}/vfx/scene/stage/star.png carried from ${sticker}`,
    ),
  );
  assert.ok(notes.includes("rule vfx/avatar/ink/** (the item's licence)"));

  // The same items again, as replaces, change nothing.
  const again = await planEffectPromotion(
    items.map((item) => {
      const { placement_hint: _hint, sound: _sound, ...rest } = item;
      return { ...rest, mode: "replace" };
    }),
    options,
  );
  assert.deepEqual(
    again.map((change) => change.path),
    [],
  );

  // Without licence entries an item would be recorded as the owner's work,
  // which its own (or its kind's) agent-authored rule contradicts.
  await assert.rejects(
    planEffectPromotion(
      [{ mode: "replace", stem: "ink", effect: await ownArtSource("ink") }],
      options,
    ),
    /licence rule vfx\/avatar\/ink\/\*\* grants other terms/,
  );
  // Any glob shape counts: the first rule matching a written file applies.
  const shaped = JSON.parse(
    await readFile(path.join(root, EFFECT_PROMOTE_PATHS.inventory), "utf8"),
  );
  const ownRule = shaped.rules.findIndex(
    (rule) => rule.glob === "vfx/avatar/ink/**",
  );
  shaped.rules[ownRule] = {
    ...shaped.rules[ownRule],
    glob: "vfx/avatar/ink/*",
  };
  await writeFile(
    path.join(root, EFFECT_PROMOTE_PATHS.inventory),
    `${JSON.stringify(shaped, null, 2)}\n`,
  );
  await assert.rejects(
    planEffectPromotion(
      [{ mode: "replace", stem: "ink", effect: await ownArtSource("ink") }],
      options,
    ),
    /licence rule vfx\/avatar\/ink\/\* grants other terms/,
  );
  shaped.rules[ownRule] = {
    ...shaped.rules[ownRule],
    glob: "vfx/avatar/ink/**",
  };
  await writeFile(
    path.join(root, EFFECT_PROMOTE_PATHS.inventory),
    `${JSON.stringify(shaped, null, 2)}\n`,
  );
  await assert.rejects(
    planEffectPromotion(
      [
        {
          kind: "reaction",
          mode: "add",
          stem: "joy-3-b",
          placement_hint: { emotion: "joy", intensity: 3 },
          project: project({ ...clip, id: "joy-3-b" }, meta.dependencies),
        },
      ],
      options,
    ),
    /licence rule reactions\/\*\*\/\* grants other terms/,
  );

  // A delete removes the effect's own rule and its copy's exact rule.
  await applyEffectPromotion(
    root,
    await planEffectPromotion(
      [{ kind: "scene_effect", mode: "delete", stem: "stage" }],
      options,
    ),
  );
  assert.ok(
    !JSON.parse(await readFile(fixture.inventoryPath, "utf8")).rules.some(
      (entry) => entry.glob.includes("scene/stage"),
    ),
  );
});

test("reused owner art keeps its record and needs no rule of its own", async () => {
  const { root, sticker, stickerRecord, inventoryPath, reviewPath } =
    await licenceRepo();
  const before = await readFile(inventoryPath, "utf8");
  const changes = await planEffectPromotion(
    [
      {
        kind: "scene_effect",
        mode: "add",
        stem: "stage",
        effect: await stickerSceneSource(root, "stage", sticker),
      },
    ],
    {
      repo: workingTreeRepo(root),
      validate,
      validateScene: () => {},
    },
  );
  await applyEffectPromotion(root, changes);
  // The copy is the owner's art: the general Scene rule already grants the
  // sticker's terms, so no exact rule is added and nothing is reported as
  // third-party.
  assert.equal(await readFile(inventoryPath, "utf8"), before);
  const records = JSON.parse(await readFile(reviewPath, "utf8")).files;
  const record = (file) =>
    records.find((entry) => entry.path === `content/included/${file}`);
  assert.deepEqual(record("vfx/scene/stage/star.png"), {
    path: "content/included/vfx/scene/stage/star.png",
    ...stickerRecord,
  });
  assert.deepEqual(record("vfx/scene/stage/own.png"), {
    path: "content/included/vfx/scene/stage/own.png",
    ...OWNER_SOURCE_REVIEW,
  });
  assert.ok(
    !changes
      .flatMap((change) => change.notes ?? [])
      .some((note) => note.includes("third-party")),
  );
});

test("promotion refuses incomplete or conflicting licence entries", async () => {
  const fixture = await licenceRepo();
  const { root, clip, meta } = fixture;
  for (const [item, message] of [
    [
      { source: "x", stem: "ink", mode: "add", licence: agentLicence },
      /go together/,
    ],
    [
      {
        stem: "ink",
        mode: "delete",
        licence: agentLicence,
        sourceReview: agentReview("B"),
      },
      /a delete takes no/,
    ],
    [
      {
        source: "x",
        stem: "ink",
        mode: "add",
        licence: { ...agentLicence, note: "x" },
        sourceReview: agentReview("B"),
      },
      /unknown field\(s\): note/,
    ],
    [
      {
        source: "x",
        stem: "ink",
        mode: "add",
        licence: agentLicence,
        sourceReview: agentReview({}),
      },
      /names no file/,
    ],
    [
      {
        source: "x",
        stem: "ink",
        mode: "add",
        licence: { ...agentLicence, glob: "../x/**" },
        sourceReview: agentReview("B"),
      },
      /below content\/included/,
    ],
  ])
    assert.throws(() => parseEffectPromoteItems([item], "items.json"), message);

  const plan = async (items) =>
    planEffectPromotion(items, {
      repo: workingTreeRepo(root),
      validate,
      validateClip,
    });
  const ink = async (overrides) => ({
    mode: "add",
    stem: "ink",
    sound: null,
    effect: await ownArtSource("ink"),
    licence: agentLicence,
    ...overrides,
  });
  await assert.rejects(
    plan([await ink({ sourceReview: agentReview({ "ink.json": "D" }) })]),
    /gives no basis for ink\.png/,
  );
  await assert.rejects(
    plan([
      await ink({
        sourceReview: agentReview({
          "ink.json": "D",
          "ink.png": "A",
          "other.png": "O",
        }),
      }),
    ]),
    /names other\.png/,
  );
  await assert.rejects(
    plan([
      await ink({
        licence: { ...agentLicence, glob: "vfx/avatar/other/**" },
        sourceReview: agentReview("B"),
      }),
    ]),
    /does not cover/,
  );
  const replace = (provenance) => ({
    kind: "reaction",
    mode: "replace",
    stem: "joy-2",
    project: project(clip, meta.dependencies),
    licence: { ...agentLicence, provenance, glob: "reactions/**/*" },
    sourceReview: agentReview("B"),
  });
  await assert.rejects(
    plan([
      replace("One"),
      {
        ...replace("Two"),
        mode: "add",
        stem: "joy-4-b",
        placement_hint: { emotion: "joy", intensity: 4 },
        project: project({ ...clip, id: "joy-4-b" }, meta.dependencies),
      },
    ]),
    /must give one licence/,
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
