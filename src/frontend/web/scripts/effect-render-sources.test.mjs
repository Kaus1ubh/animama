import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  INCLUDED_EFFECT_ROOT,
  listIncludedEffects,
  resolveClipSource,
  resolveEffectSource,
} from "./effect-render-sources.mjs";
import { MAX_TIME_SEC, parseTimes } from "./effect-render.mjs";

let localContent;
let outsideDir;

async function writeEffect(root, stem, { name = stem, image = `${stem}.png` }) {
  const folder = path.join(root, "vfx/avatar", stem);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${stem}.png`), "png");
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify({
      content_type: "avatar_effect",
      content_id: `local:avatar-effect:${stem}`,
      name,
      definition: { kind: "texture", image },
    }),
  );
  return folder;
}

before(async () => {
  localContent = await realpath(
    await mkdtemp(path.join(tmpdir(), "animama-effect-sources-")),
  );
  await writeEffect(localContent, "sparkle", { name: "Sparkle Burst" });
  // Same stem as an Included effect, to exercise ambiguity.
  await writeEffect(localContent, "eye", { name: "Local Eye" });
  await writeEffect(localContent, "escape", { image: "../outside.png" });
  // Files outside the content root, reached only through symlinks.
  outsideDir = await realpath(
    await mkdtemp(path.join(tmpdir(), "animama-effect-outside-")),
  );
  await writeFile(path.join(outsideDir, "secret.png"), "secret");
  await writeFile(path.join(outsideDir, "secret.json"), "{}");
  const linked = await writeEffect(localContent, "linked", {
    image: "linked-image.png",
  });
  await symlink(
    path.join(outsideDir, "secret.png"),
    path.join(linked, "linked-image.png"),
  );
  const gesture = path.join(localContent, "gestures/wave");
  await mkdir(gesture, { recursive: true });
  await writeFile(
    path.join(gesture, "wave.meta.json"),
    JSON.stringify({
      content_type: "gesture",
      content_id: "local:gesture:wave",
      name: "Wave",
      implementation: { kind: "anima_clip", file_role: "sequence" },
      files: [{ path: "wave.json", role: "sequence" }],
    }),
  );
  await writeFile(
    path.join(gesture, "wave.json"),
    JSON.stringify({ schema: "animaPoseClip/1.0", id: "wave" }),
  );
});

after(async () => {
  await rm(localContent, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

test("lists every Included effect descriptor and skips asset folders", async () => {
  const effects = await listIncludedEffects();
  assert.equal(effects.length, 16);
  assert.ok(!effects.some((effect) => effect.stem === "face"));
  for (const effect of effects) {
    assert.ok(effect.imagePath.startsWith(INCLUDED_EFFECT_ROOT));
  }
});

test("resolves Included effects by stem, content id, name and path", async () => {
  const byStem = await resolveEffectSource("library:eye_vv_pair");
  assert.equal(byStem.stem, "eye_vv_pair");
  assert.equal(
    byStem.imagePath,
    path.join(INCLUDED_EFFECT_ROOT, "eye_vv_pair/eye_vv.png"),
  );
  const byId = await resolveEffectSource(
    "library:included/builtin:avatar-effect:angry",
  );
  assert.equal(byId.stem, "angry");
  const byName = await resolveEffectSource("library:eye vv PAIR");
  assert.equal(byName.stem, "eye_vv_pair");
  const byFolder = await resolveEffectSource(
    path.join(INCLUDED_EFFECT_ROOT, "star"),
  );
  assert.equal(byFolder.name, "Star");
  const byFile = await resolveEffectSource("star/star.json", {
    cwd: INCLUDED_EFFECT_ROOT,
  });
  assert.equal(
    byFile.descriptorPath,
    path.join(INCLUDED_EFFECT_ROOT, "star/star.json"),
  );
});

test("resolves local effects only with a local content root", async () => {
  await assert.rejects(
    resolveEffectSource("library:local/sparkle"),
    /--local-content/,
  );
  const local = await resolveEffectSource("library:local/Sparkle Burst", {
    localContent,
  });
  assert.equal(local.stem, "sparkle");
  assert.ok(local.imagePath.startsWith(localContent));
  // Unscoped search covers both roots.
  const unscoped = await resolveEffectSource("library:sparkle", {
    localContent,
  });
  assert.equal(unscoped.contentId, "local:avatar-effect:sparkle");
});

test("rejects ambiguous, missing and escaping sources", async () => {
  await assert.rejects(
    resolveEffectSource("library:eye", { localContent }),
    /ambiguous \(included\/eye, local\/eye\)/,
  );
  const scoped = await resolveEffectSource("library:included/eye", {
    localContent,
  });
  assert.equal(scoped.contentId, "builtin:avatar-effect:eye");
  await assert.rejects(resolveEffectSource("library:nope"), /No effect/);
  await assert.rejects(
    resolveEffectSource("library:local/escape", { localContent }),
    /Effect image "..\/outside.png" leaves/,
  );
  await assert.rejects(
    resolveEffectSource(path.join(localContent, "missing")),
    /does not exist/,
  );
});

test("resolves Gesture clips from the library and from paths", async () => {
  const included = await resolveClipSource("library:arms-crossed");
  assert.equal(included.clip.schema, "animaPoseClip/1.0");
  assert.equal(included.clip.id, "arms-crossed");
  const local = await resolveClipSource("library:local/local:gesture:wave", {
    localContent,
  });
  assert.equal(local.clip.id, "wave");
  const byMeta = await resolveClipSource(
    path.join(localContent, "gestures/wave/wave.meta.json"),
  );
  assert.equal(
    byMeta.clipPath,
    path.join(localContent, "gestures/wave/wave.json"),
  );
  const raw = await resolveClipSource(byMeta.clipPath);
  assert.equal(raw.clip.id, "wave");
});

test("rejects symlinks that resolve outside their folder", async () => {
  await assert.rejects(
    resolveEffectSource("library:local/linked", { localContent }),
    /Effect image "linked-image.png" leaves/,
  );
  const gesture = path.join(localContent, "gestures/linked");
  await mkdir(gesture, { recursive: true });
  await writeFile(
    path.join(gesture, "linked.meta.json"),
    JSON.stringify({
      content_type: "gesture",
      name: "Linked",
      implementation: { kind: "anima_clip", file_role: "sequence" },
      files: [{ path: "linked.json", role: "sequence" }],
    }),
  );
  await symlink(
    path.join(outsideDir, "secret.json"),
    path.join(gesture, "linked.json"),
  );
  await assert.rejects(
    resolveClipSource("library:local/linked", { localContent }),
    /Gesture clip "linked.json" leaves/,
  );
  // A descriptor linked in from outside poisons the library scan.
  const effectRoot = path.join(localContent, "vfx/avatar");
  await mkdir(path.join(effectRoot, "foreign"));
  await symlink(
    path.join(outsideDir, "secret.json"),
    path.join(effectRoot, "foreign/foreign.json"),
  );
  try {
    await assert.rejects(
      resolveEffectSource("library:local/sparkle", { localContent }),
      /Descriptor "foreign\/foreign.json" leaves/,
    );
  } finally {
    await rm(path.join(effectRoot, "foreign"), { recursive: true });
  }
});

test("parses --times as bounded ascending seconds", () => {
  assert.deepEqual(parseTimes(undefined, [1]), [1]);
  assert.deepEqual(parseTimes("2, 0.5,0.5,0"), [0, 0.5, 2]);
  assert.deepEqual(parseTimes(String(MAX_TIME_SEC), []), [MAX_TIME_SEC]);
  for (const value of ["", "1,,2", "1,", "-1", "abc", "Infinity", "31"]) {
    assert.throws(() => parseTimes(value, []), /Invalid --times/, value);
  }
});
