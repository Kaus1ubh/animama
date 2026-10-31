import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { chromium } from "playwright";

import { startComboServer } from "./animation-combo.mjs";
import { listSheetItems } from "./animation-reel-sheet.mjs";

// The page plays a Gesture and a Reaction together, adds a face weight, and
// copies a cue sheet take the reel recorder accepts.
test("plays a combination and copies it as a cue sheet take", async () => {
  const server = await startComboServer({
    avatars: [{ value: "Annie", file: false }],
  });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
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
    await page.selectOption("#gesture", "library:gesture/big-arm-heart");
    await page.selectOption("#gesture-from", "heart");
    await page.selectOption("#reaction", "library:reaction/love-3");
    await page.fill("#reaction-hold", "2");
    await page.click("#play");
    await page.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Love 3"),
    );
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
