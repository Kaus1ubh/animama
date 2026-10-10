import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import sharp from "sharp";

import { INCLUDED_CONTENT_ROOT } from "./effect-render-sources.mjs";

/**
 * `effects save` for Particle and Scene Effects against a running stack: it
 * saves through each creator, reads the items back, revises them and refuses
 * a name the app would refuse. It writes Local content, so it runs only when
 * asked, with the stack record sourced:
 *
 *   ANIMAMA_EFFECT_SAVE_STACK=1 node --test scripts/effect-save.stack.test.mjs
 *
 * The items it saves are deleted afterwards.
 */

const origin = process.env.ANIMAMA_PUBLIC_ORIGIN;
const skip =
  process.env.ANIMAMA_EFFECT_SAVE_STACK === "1" && origin
    ? false
    : "set ANIMAMA_EFFECT_SAVE_STACK=1 and source the stack record";
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const run = `stack-${process.pid}-${Date.now().toString(36)}`;
const names = { particle: `Save ${run} particle`, scene: `Save ${run} scene` };

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-effect-save-"));
});
after(async () => {
  if (!skip)
    for (const [api, name] of [
      ["/v1/particle-effects", names.particle],
      ["/v1/scene-effects", names.scene],
    ]) {
      const list = await (await fetch(`${origin}${api}`)).json();
      for (const item of list.items ?? [])
        if (item.source === "local" && item.name === name) {
          const saved = await (
            await fetch(`${origin}${api}/${encodeURIComponent(item.item_id)}`)
          ).json();
          await fetch(
            `${origin}/v1/content/items/${encodeURIComponent(item.item_id)}?expected_revision=${encodeURIComponent(saved.revision_sha256)}`,
            {
              method: "DELETE",
              // A deliberate local operator request, as the gateway admits.
              headers: { "x-animama-csrf": "1", "sec-fetch-site": "none" },
            },
          );
        }
    }
  await rm(dir, { recursive: true, force: true });
});

/** A coloured disc PNG, `size` pixels square. */
function disc(size, colour) {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.4}" fill="${colour}"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

/**
 * The Included `hearts-v1` with its texture renamed, so the creator has no
 * built-in copy and asks for the file.
 */
async function particleFolder() {
  const folder = path.join(dir, "glow");
  await cp(
    path.join(INCLUDED_CONTENT_ROOT, "vfx/particle/quark/hearts-v1"),
    folder,
    {
      recursive: true,
    },
  );
  await rm(path.join(folder, "textures/heart.png"));
  await writeFile(
    path.join(folder, "textures/glow.png"),
    await disc(64, "#ffd34d"),
  );
  const rename = (text) =>
    text.replaceAll("textures/heart.png", "textures/glow.png");
  const manifest = path.join(folder, "particle.json");
  await writeFile(manifest, rename(await readFile(manifest, "utf8")));
  await writeFile(
    path.join(folder, "glow.json"),
    rename(await readFile(path.join(folder, "hearts-v1.json"), "utf8")),
  );
  await rm(path.join(folder, "hearts-v1.json"));
  return folder;
}

/** The every-layer Scene fixture, with a PNG tile and scatter item. */
async function sceneFolder(screenCount) {
  const folder = path.join(dir, "layers");
  await mkdir(folder, { recursive: true });
  const definition = JSON.parse(
    await readFile(
      path.join(
        webRoot,
        "src/lib/content/fixtures/scene-effect-all-layers.json",
      ),
      "utf8",
    ),
  );
  definition.screen.count = screenCount;
  await writeFile(path.join(folder, "bokeh.png"), await disc(96, "#ffffff"));
  await writeFile(path.join(folder, "petal.png"), await disc(64, "#ff5c93"));
  await writeFile(
    path.join(folder, "layers.json"),
    JSON.stringify({
      content_type: "scene_effect",
      name: "Layers",
      description: "Every Scene layer",
      definition,
      files: [
        { path: "bokeh.png", role: "image" },
        { path: "petal.png", role: "image" },
      ],
    }),
  );
  return folder;
}

/** Run `effects save` on `items`; resolves with the exit code and output. */
async function save(items) {
  const file = path.join(dir, "items.json");
  await writeFile(file, JSON.stringify(items));
  return promisify(execFile)(
    process.execPath,
    [path.join(webRoot, "scripts/effects.mjs"), "save", file, "--url", origin],
    { cwd: webRoot, timeout: 600_000 },
  ).then(
    ({ stdout }) => ({ code: 0, stdout }),
    (error) => ({ code: error.code, stdout: error.stdout ?? "" }),
  );
}

test(
  "effects save saves, revises and refuses Particle and Scene Effects",
  { skip, timeout: 1_500_000 },
  async () => {
    const particle = await particleFolder();
    const items = [
      { source: particle, name: names.particle },
      { source: await sceneFolder(20), name: names.scene },
    ];
    const first = await save(items);
    assert.equal(first.code, 0, first.stdout);
    assert.match(
      first.stdout,
      new RegExp(`Saved ${names.particle}: .*/particle-effects/`),
    );
    assert.match(
      first.stdout,
      new RegExp(`Saved ${names.scene}: .*/scene-effects/`),
    );

    // A second save of the same names revises the items.
    await rm(path.join(dir, "layers"), { recursive: true });
    items[1].source = await sceneFolder(24);
    const second = await save(items);
    assert.equal(second.code, 0, second.stdout);
    assert.match(second.stdout, new RegExp(`Revised ${names.particle}:`));
    assert.match(second.stdout, new RegExp(`Revised ${names.scene}:`));
    const list = await (await fetch(`${origin}/v1/scene-effects`)).json();
    const scene = list.items.find(
      (item) => item.source === "local" && item.name === names.scene,
    );
    const saved = await (
      await fetch(
        `${origin}/v1/scene-effects/${encodeURIComponent(scene.item_id)}`,
      )
    ).json();
    assert.equal(saved.definition.screen.count, 24);

    const refused = await save([{ source: particle, name: "Glow (copy)" }]);
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /is not a valid Local name/);
  },
);
