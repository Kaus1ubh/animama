import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { startTuneServer } from "./content-tune.mjs";
import { INCLUDED_CONTENT_ROOT } from "./effect-render-sources.mjs";

// The fixture plays a generated tone under a key the tracked pack manifest
// lists, so no licensed audio is needed.
const SOUND_KEY = "bubble_pop_01";

/** A short mono 16-bit WAV tone. */
function tone(seconds = 0.2, rate = 8000) {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1)
    data.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 440 * index) / rate)),
      index * 2,
    );
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

let dir;
let tune;
let browser;
before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "content-tune-")));
  // A content/included tree, as the pack check expects.
  const content = path.join(dir, "content/included");
  await cp(
    path.join(INCLUDED_CONTENT_ROOT, "gestures/air-guitar"),
    path.join(content, "gestures/air-guitar"),
    { recursive: true },
  );
  await cp(
    path.join(INCLUDED_CONTENT_ROOT, "reactions/joy-2"),
    path.join(content, "reactions/joy-2"),
    { recursive: true },
  );
  // A Gesture that plays the pack sound through an sfx event.
  const folder = path.join(content, "gestures/pop-wave");
  await writeJson(path.join(folder, "pop-wave.json"), {
    schema: "animaPoseClip/2.0",
    id: "pop-wave",
    name: "Pop Wave",
    duration: 1,
    beats: [{ id: "a", label: "A", time: 0 }],
    expressions: { happy: [{ v: 0.6, beat: "a" }] },
    events: [{ id: "pop", time: 0.1, kind: "sfx", cueId: "pop" }],
  });
  await writeJson(path.join(folder, "pop-wave.meta.json"), {
    schema_version: 1,
    content_type: "gesture",
    content_id: "builtin:gesture:pop-wave",
    version: 1,
    name: "Pop Wave",
    semantic_key: "pop_wave",
    implementation: { kind: "anima_clip", file_role: "sequence" },
    dependencies: [
      {
        ref: `builtin:sound-effect:${SOUND_KEY}`,
        alias: "pop",
        content_type: "sound_effect",
        optional: true,
        config: {},
      },
    ],
    files: [{ path: "pop-wave.json", role: "sequence" }],
  });
  const pack = path.join(dir, "pack/sfx/wow-comedy");
  await mkdir(pack, { recursive: true });
  await writeFile(path.join(pack, `${SOUND_KEY}.wav`), tone());
  await writeJson(path.join(pack, `${SOUND_KEY}.meta.json`), {
    content_type: "sound_effect",
    content_id: `builtin:sound-effect:${SOUND_KEY}`,
    name: "Fixture Pop",
    files: [{ path: `${SOUND_KEY}.wav` }],
  });
  tune = await startTuneServer({
    contentRoot: content,
    soundRoots: [path.join(dir, "pack")],
  });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
});
after(async () => {
  await browser?.close();
  await tune?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("lists content, auditions a sound and previews a Gesture with its sound", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(tune.url);
  await page.getByText("2 Gestures · 1 Reactions").waitFor();

  // The ladder places the Reaction in its cell.
  await page.getByRole("tab", { name: "Reaction ladder" }).click();
  await page.getByRole("row", { name: /^joy/i }).getByRole("button").click();
  await page.getByRole("heading", { name: "Joy Reaction 2" }).waitFor();

  // The pack's sound is listed as shipped and can be auditioned.
  await page.getByRole("tab", { name: "Sounds" }).click();
  const audition = page.waitForRequest(`**/__tune/sound/${SOUND_KEY}`);
  await page.getByRole("button", { name: "Play Fixture Pop" }).click();
  await audition;
  const row = page.locator("li", { hasText: "Fixture Pop" });
  assert.equal(await row.getByText("In pack").count(), 1);
  // Manifest sounds with no local audio are listed but can't be played.
  assert.equal(
    await page
      .getByRole("tabpanel")
      .locator("li button:not([disabled])")
      .count(),
    1,
  );

  // Previewing the Gesture plays its sfx event's sound.
  await page.getByRole("tab", { name: "Gestures" }).click();
  await page.getByRole("button", { name: /Pop Wave/ }).click();
  assert.equal(
    await page.getByRole("cell", { name: "Fixture Pop" }).count(),
    1,
  );
  const played = page.waitForRequest(`**/__tune/sound/${SOUND_KEY}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await played;
  assert.deepEqual(errors, []);
  await page.close();
});

test("serves only listed sounds, resolves only Included effects and reports broken items", async () => {
  for (const key of ["unknown_01", "..%2F..%2Fpackage.json", "%2Fetc%2Fpasswd"])
    assert.equal(
      (await fetch(`${tune.origin}/__tune/sound/${key}`)).status,
      404,
    );
  const media = await fetch(`${tune.origin}/__tune/media`, {
    method: "POST",
    headers: { origin: tune.origin, "content-type": "application/json" },
    body: JSON.stringify({
      dependencies: [
        {
          alias: "x",
          ref: "../../../package.json",
          content_type: "avatar_effect",
        },
      ],
    }),
  });
  const body = await media.json();
  assert.equal(media.status, 200);
  assert.deepEqual(body.clipMedia.avatarEffects, []);
  assert.equal(body.notices.length, 1);
  // A broken item is named instead of failing the page.
  const broken = path.join(dir, "content/included/reactions/broken-1");
  await mkdir(broken, { recursive: true });
  await writeFile(path.join(broken, "broken-1.meta.json"), "{ nope");
  try {
    const state = await (await fetch(`${tune.origin}/__tune/state`)).json();
    assert.equal(state.reactions.length, 1);
    assert.match(state.problems[0], /broken-1\.meta\.json/);
  } finally {
    await rm(broken, { recursive: true, force: true });
  }
});

test("refuses requests from other origins", async () => {
  const response = await fetch(`${tune.origin}/__tune/state`, {
    headers: { origin: "http://example.test" },
  });
  assert.equal(response.status, 403);
  const media = await fetch(`${tune.origin}/__tune/media`, {
    method: "POST",
    body: JSON.stringify({ dependencies: [] }),
  });
  // A write without our Origin header is refused too.
  assert.equal(media.status, 403);
  // So is another site's subresource request, which carries no Origin.
  const audio = await fetch(`${tune.origin}/__tune/sound/${SOUND_KEY}`, {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(audio.status, 403);
});

test("edits a Reaction's expression and sound and saves them", async () => {
  const folder = path.join(dir, "content/included/reactions/joy-2");
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.setDefaultTimeout(90_000);
  await page.goto(tune.url);
  await page.getByRole("tab", { name: "Reaction ladder" }).click();
  await page.getByRole("row", { name: /^joy/i }).getByRole("button").click();
  await page.getByRole("heading", { name: /Joy Reaction 2/ }).waitFor();

  await page.getByLabel("happy peak value").fill("0.4");
  await page.getByRole("button", { name: "+ Sound" }).click();
  await page.getByPlaceholder("Search sounds").fill("Fixture");
  await page.getByRole("button", { name: /^Fixture Pop/ }).click();
  await page.getByText("(edited)").waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved builtin:reaction:joy-2.").waitFor();

  const clip = JSON.parse(
    await readFile(path.join(folder, "joy-2.json"), "utf8"),
  );
  const meta = JSON.parse(
    await readFile(path.join(folder, "joy-2.meta.json"), "utf8"),
  );
  assert.equal(clip.expressions.happy[0].v, 0.4);
  const sound = clip.events.find((event) => event.kind === "sfx");
  assert.ok(sound);
  assert.deepEqual(
    meta.dependencies.find((edge) => edge.alias === sound.cueId),
    {
      ref: `builtin:sound-effect:${SOUND_KEY}`,
      alias: sound.cueId,
      content_type: "sound_effect",
      config: {},
      optional: true,
    },
  );
  // Saved and reloaded: no longer edited, and the pack check agrees.
  assert.equal(await page.getByText("(edited)").count(), 0);
  const pending = await (await fetch(`${tune.origin}/__tune/pending`)).json();
  assert.deepEqual(pending.additions, []);
  await page.close();
});
