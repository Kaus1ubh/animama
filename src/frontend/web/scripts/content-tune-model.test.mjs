import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  itemRevision,
  listTuneItems,
  listTuneSounds,
  listVendorCatalog,
  publicItem,
  soundDisplayName,
  vendorSoundKey,
} from "./content-tune-model.mjs";

async function tempDir(t) {
  // Real, so paths compare with the real files the model returns.
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "content-tune-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function write(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}

test("derives pack keys and names from vendor file names", () => {
  assert.equal(vendorSoundKey("AC_Funny_Sweat_02.ogg"), "funny_sweat_02");
  assert.equal(
    vendorSoundKey("AC_Bouncy_Bubble_01v1.ogg"),
    "bouncy_bubble_01v1",
  );
  assert.equal(vendorSoundKey("notes.txt"), null);
  assert.equal(vendorSoundKey(".DS_Store"), null);
  assert.equal(soundDisplayName("funny_sweat_02"), "Funny Sweat 02");
});

test("lists the vendor catalog by category, preferring Ogg", async (t) => {
  const root = await tempDir(t);
  await write(path.join(root, "Bubble/AC_Bubble_Pop_01.ogg"), "ogg");
  await write(path.join(root, "Bubble/AC_Bubble_Pop_01.wav"), "wav");
  await write(path.join(root, "Impacts/Big/AC_Anger_Explode_03.ogg"), "ogg");
  await write(path.join(root, "AC_Loose_01.ogg"), "ogg");
  await write(path.join(root, "Bubble/readme.txt"), "text");

  const catalog = await listVendorCatalog(root);

  assert.deepEqual(
    catalog
      .map(({ key, category, file }) => [key, category, path.extname(file)])
      .sort(),
    [
      ["anger_explode_03", "Impacts", ".ogg"],
      ["bubble_pop_01", "Bubble", ".ogg"],
      ["loose_01", "Other", ".ogg"],
    ],
  );
  assert.deepEqual(await listVendorCatalog(path.join(root, "missing")), []);
  assert.deepEqual(await listVendorCatalog(null), []);
});

test("merges the catalog, the pack and the manifest into one sound list", async (t) => {
  const root = await tempDir(t);
  const catalogDir = path.join(root, "catalog");
  const pack = path.join(root, "pack");
  await write(path.join(catalogDir, "Bubble/AC_Bubble_Pop_01.ogg"), "ogg");
  await write(path.join(catalogDir, "Misc/AC_Ding_02.ogg"), "ogg");
  await write(path.join(pack, "sfx/wow-comedy/bubble_pop_01.ogg"), "ogg");
  await write(path.join(pack, "sfx/wow-comedy/bubble_pop_01.meta.json"), {
    content_type: "sound_effect",
    content_id: "builtin:sound-effect:bubble_pop_01",
    name: "Bubble Pop",
    duration_seconds: 0.4,
  });
  const manifest = {
    files: [
      { path: "sfx/wow-comedy/bubble_pop_01.ogg" },
      { path: "sfx/wow-comedy/gone_01.ogg" },
    ],
  };

  const sounds = await listTuneSounds({
    catalogDir,
    packRoots: [pack],
    manifest,
  });

  assert.deepEqual(
    sounds.map(({ key, name, category, shipped, duration, file }) => ({
      key,
      name,
      category,
      shipped,
      duration,
      file: file && path.relative(root, file),
    })),
    [
      {
        key: "bubble_pop_01",
        name: "Bubble Pop",
        category: "Bubble",
        shipped: true,
        duration: 0.4,
        file: "catalog/Bubble/AC_Bubble_Pop_01.ogg",
      },
      {
        key: "ding_02",
        name: "Ding 02",
        category: "Misc",
        shipped: false,
        duration: null,
        file: "catalog/Misc/AC_Ding_02.ogg",
      },
      {
        // In the manifest, but neither root holds its audio.
        key: "gone_01",
        name: "Gone 01",
        category: "Pack",
        shipped: true,
        duration: null,
        file: null,
      },
    ],
  );
  // Without the vendor catalog, the pack's own files are previewed.
  const packOnly = await listTuneSounds({ packRoots: [pack], manifest });
  assert.equal(
    path.relative(root, packOnly.find((s) => s.key === "bubble_pop_01").file),
    "pack/sfx/wow-comedy/bubble_pop_01.ogg",
  );
});

test("lists Included Gestures and Reactions with clips and revisions", async (t) => {
  const root = await tempDir(t);
  const clip = { schema: "animaPoseClip/2.0", id: "cheer", events: [] };
  const meta = {
    schema_version: 1,
    content_type: "reaction",
    content_id: "builtin:reaction:joy-2",
    version: 1,
    name: "Joy Reaction 2",
    placement_hint: { emotion: "joy", intensity: 2 },
    implementation: { kind: "anima_clip", file_role: "sequence" },
    dependencies: [],
    files: [{ path: "joy-2.json", role: "sequence" }],
  };
  await write(path.join(root, "reactions/joy-2/joy-2.meta.json"), meta);
  await write(path.join(root, "reactions/joy-2/joy-2.json"), clip);
  await write(path.join(root, "gestures/wave/wave.meta.json"), {
    ...meta,
    content_type: "gesture",
    content_id: "builtin:gesture:wave",
    implementation: { kind: "vrma", file_role: "animation" },
    files: [{ path: "wave.vrma", role: "animation" }],
  });

  const { gestures, reactions } = await listTuneItems(root);

  // A VRMA Gesture has no clip to tune.
  assert.deepEqual(gestures, []);
  const [reaction] = reactions;
  assert.equal(reaction.stem, "joy-2");
  assert.equal(reaction.emotion, "joy");
  assert.equal(reaction.intensity, 2);
  assert.deepEqual(reaction.clip, clip);
  assert.equal(
    reaction.revision,
    itemRevision(JSON.stringify(meta, null, 2), JSON.stringify(clip, null, 2)),
  );
  assert.equal("metaPath" in publicItem(reaction), false);
  assert.equal("clipPath" in publicItem(reaction), false);
});
