import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { chromium } from "playwright";

import { startComboServer } from "./animation-combo.mjs";
import { listSheetItems } from "./animation-reel-sheet.mjs";

// The page plays a Gesture and a Reaction together, keeps effects on, adds a
// face weight, and copies a cue sheet take the reel recorder accepts.
test("plays a combination and copies it as a cue sheet take", async () => {
  const server = await startComboServer({
    avatars: [
      { value: "Annie", file: false },
      { value: "Andrew", file: false },
    ],
  });
  // The macOS GPU draws in real time; SwiftShader elsewhere is too slow to.
  const gpu = process.platform === "darwin";
  const browser = await chromium.launch({
    args: gpu
      ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const dir = await mkdtemp(path.join(tmpdir(), "animama-combo-"));
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.comboReady === true, null, {
      timeout: 120_000,
    });
    const state = () => page.evaluate(() => window.comboState());
    // Session time follows the wall clock (timed in the page).
    const rate = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const begin = [performance.now(), window.comboState().time];
          setTimeout(() => {
            const time = window.comboState().time - begin[1];
            resolve(time / ((performance.now() - begin[0]) / 1000));
          }, 2000);
        }),
    );
    if (gpu) assert.ok(rate > 0.85 && rate < 1.15, `${rate}x real time`);
    else assert.ok(rate > 0, "session time advances");
    // Switching Avatars twice in a row leaves one on stage.
    await page.selectOption("#avatar", "1");
    await page.selectOption("#avatar", "0");
    await page.waitForFunction(
      () => document.querySelector("#status")?.textContent === "Annie ready.",
      null,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(3000);
    assert.equal((await state()).avatarsOnStage, 1);
    // An Avatar and a Particle Effect stay on; the face camera follows.
    await page.fill("#effect-filter", "blush");
    await page.locator(".effect:visible input").first().check();
    await page.fill("#effect-filter", "sparkle hearts");
    await page.locator(".effect:visible input").first().check();
    await page.check("#applied-only");
    await page.fill("#effect-filter", "");
    assert.equal(await page.locator(".effect:visible").count(), 2);
    // A ticked Particle Effect replays when it ends (Sparkle Hearts lasts
    // at most 4.5 s).
    await page.waitForTimeout(6000);
    assert.ok(
      (await state()).particles.includes(
        "combo:builtin:particle-effect:sparkle-hearts",
      ),
    );
    await page.selectOption("#camera", "face");
    await page.waitForTimeout(500);
    assert.doesNotMatch(await page.textContent("#status"), /did not/);
    await page.selectOption("#gesture", "library:gesture/big-arm-heart");
    await page.selectOption("#gesture-from", "heart");
    await page.selectOption("#reaction", "library:reaction/love-3");
    await page.fill("#reaction-hold", "2");
    await page.click("#play");
    await page.waitForFunction(() => {
      const playing = window.comboState();
      return playing?.gesture && playing.reaction;
    });
    await page.fill("#expression-filter", "happy");
    await page
      .locator(".expression:visible input[type=range]")
      .first()
      .fill("0.5");
    await page.click("#copy");
    const take = JSON.parse(await page.inputValue("#sheet"));
    assert.deepEqual(take.cues, [
      { gesture: "library:gesture/big-arm-heart", at: 0, from: "heart" },
      { reaction: "library:reaction/love-3", at: 0, until: 2 },
      { face: { happy: 0.5 }, at: 0, until: take.duration, fade: 0 },
    ]);
    const sheet = path.join(dir, "take.json");
    await writeFile(sheet, JSON.stringify(take));
    const [item] = await listSheetItems(sheet);
    assert.equal(item.cues.length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
