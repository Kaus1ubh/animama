import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

import { startPreviewServer } from "./animation-preview.mjs";

const clip = (headTurn) => ({
  schema: "animaPoseClip/1.0",
  id: "preview-probe",
  name: "Preview Probe",
  duration: 1,
  basePose: "relaxedRest",
  poses: {
    a: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
    b: { humanoid: { head: { rotation: [0, headTurn, 0, 0.9659] } } },
  },
  poseKeyframes: [
    { time: 0, pose: "a" },
    { time: 1, pose: "b" },
  ],
});

// Real Avatars and WebGL: notes, live reload and the previous version.
test("previews a clip, saves a review note and reloads a changed source", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-preview-"));
  const source = path.join(dir, "probe.json");
  await writeFile(source, JSON.stringify(clip(0.2588)));
  const preview = await startPreviewServer({
    sources: ["probe.json"],
    cwd: dir,
    localContent: null,
  });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(preview.url);
    await page.waitForFunction(() => window.animationPreview?.ready, null, {
      timeout: 90_000,
    });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator(".view-label").count(), 2);
    assert.equal(await page.locator(".marker").count(), 2);

    // Scrubbing pauses and moves every Avatar to that time.
    await page.evaluate(() => {
      const scrubber = document.querySelector("#scrubber");
      scrubber.value = "0.5";
      scrubber.dispatchEvent(new Event("input"));
    });
    assert.equal(await page.evaluate(() => window.animationPreview.time), 0.5);
    assert.equal(await page.textContent("#play"), "Play");

    // A note added in the page lands in the sidecar beside the source.
    await page.fill("#note-text", "Turn the head further");
    await page.selectOption("#note-region", "head");
    await page.click("#note-add");
    await page.locator(".note").first().waitFor();
    const sidecar = JSON.parse(
      await readFile(path.join(dir, "probe.review.json"), "utf8"),
    );
    assert.equal(sidecar.notes.length, 1);
    assert.equal(sidecar.notes[0].text, "Turn the head further");
    assert.equal(sidecar.notes[0].region, "head");

    // A changed source reloads and offers the previous version.
    const generation = await page.evaluate(
      () => window.animationPreview.generation,
    );
    await writeFile(source, JSON.stringify(clip(0.5)));
    await page.waitForFunction(
      (before) => window.animationPreview.generation > before,
      generation,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      () => !document.querySelector("#previous").disabled,
    );
    await page.check("#previous");
    await page.waitForFunction(
      () => document.querySelectorAll(".view-label").length === 4,
    );

    // Cross-site writes are refused.
    const refused = await fetch(`${preview.origin}/__preview/notes`, {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ time: 0, text: "x" }),
    });
    assert.equal(refused.status, 403);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await preview.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// A 2.0 clip plays through the real Avatar with its beats as markers.
test("previews an animaPoseClip/2.0 clip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-preview-v2-"));
  await writeFile(
    path.join(dir, "wave.clip.json"),
    JSON.stringify({
      schema: "animaPoseClip/2.0",
      id: "wave",
      name: "Wave",
      duration: 1.5,
      basePose: "relaxedRest",
      plantFeet: true,
      beats: [
        { id: "start", label: "Start", time: 0 },
        { id: "raise", label: "Raise", time: 0.6 },
        { id: "settle", label: "Settle", time: 1.5 },
      ],
      joints: {
        rightUpperArm: {
          elevation: [
            { beat: "start", v: "base" },
            { beat: "raise", v: 110 },
            { beat: "settle", v: "base" },
          ],
        },
        hips: { flexion: [{ beat: "raise", v: 6 }] },
      },
      hands: { right: [{ beat: "raise", preset: "open-together" }] },
    }),
  );
  const preview = await startPreviewServer({
    sources: ["wave.clip.json"],
    cwd: dir,
    localContent: null,
  });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(preview.url);
    await page.waitForFunction(() => window.animationPreview?.ready, null, {
      timeout: 90_000,
    });
    assert.deepEqual(await page.locator(".marker").allTextContents(), [
      "Start",
      "Raise",
      "Settle",
    ]);
    await page.evaluate(() => {
      const scrubber = document.querySelector("#scrubber");
      scrubber.value = "0.6";
      scrubber.dispatchEvent(new Event("input"));
    });
    assert.equal(await page.evaluate(() => window.animationPreview.time), 0.6);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await preview.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// The pickers switch sources without a restart, and only to listed ones.
test("picks another source and a comparison in the page", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-preview-pick-"));
  await writeFile(path.join(dir, "first.json"), JSON.stringify(clip(0.2588)));
  await writeFile(path.join(dir, "second.json"), JSON.stringify(clip(0.5)));
  const preview = await startPreviewServer({
    sources: ["first.json"],
    notes: "custom.review.json",
    cwd: dir,
    localContent: null,
  });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(preview.url);
    await page.waitForFunction(() => window.animationPreview?.ready, null, {
      timeout: 90_000,
    });
    const second = path.join(dir, "second.json");
    assert.equal(
      await page.inputValue("#pick-source"),
      path.join(dir, "first.json"),
    );
    // Included Library items are offered too.
    assert.ok(
      await page
        .locator("#pick-source option[value^='library:included/']")
        .count(),
    );

    // Pause past the middle, so the switch's reset to 0 is observable.
    await page.click("#play");
    await page.evaluate(() => {
      const scrubber = document.querySelector("#scrubber");
      scrubber.value = "0.8";
      scrubber.dispatchEvent(new Event("input"));
    });
    await page.selectOption("#pick-source", second);
    await page.waitForFunction(() =>
      document.querySelector(".view-label")?.textContent?.includes("second"),
    );
    assert.equal(preview.session.state().rows[0].path, second);
    assert.equal(await page.evaluate(() => window.animationPreview.time), 0);

    await page.selectOption("#pick-compare", path.join(dir, "first.json"));
    await page.waitForFunction(
      () => document.querySelectorAll(".view-label").length === 4,
    );

    // Anything not listed is refused, and the open session stays.
    const refused = await page.evaluate(async () => {
      const response = await fetch("/__preview/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "/etc/hosts" }),
      });
      return response.status;
    });
    assert.equal(refused, 400);
    assert.equal(preview.session.state().rows[0].path, second);

    // --notes stays with the source it was given for.
    assert.equal(
      preview.session.reviewPaths.sidecar,
      path.join(dir, "second.review.json"),
    );
    await page.selectOption("#pick-source", path.join(dir, "first.json"));
    await page.waitForFunction(() =>
      document.querySelector(".view-label")?.textContent?.includes("first"),
    );
    assert.equal(
      preview.session.reviewPaths.sidecar,
      path.join(dir, "custom.review.json"),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await preview.close();
    await rm(dir, { recursive: true, force: true });
  }
});
