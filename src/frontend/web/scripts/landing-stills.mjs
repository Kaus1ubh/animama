import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

import { startStageServer } from "./landing-stage.mjs";
import { stageDir } from "./landing-stage-content.mjs";

/**
 * Capture the stills the landing page shows where its live 3D stage cannot
 * run (`landing-stage/stills.ts`): her alone, on a transparent background,
 * at each stop in the wide (desktop) and tall (phone) framings, as
 * `landing-stage/stills/<stop>-<wide|tall>.webp`.
 *
 *   pnpm -s landing:stills
 *
 * Starts its own stage server and renders on the GPU, so run it on a
 * machine with one; recapture after changing an Avatar, a stop's camera or
 * its clips.
 */
const FRAMINGS = [
  { name: "wide", width: 1440, height: 900, scale: 1.5 },
  { name: "tall", width: 390, height: 844, scale: 2 },
];
/** How long after arriving at a stop to capture: into its first clip. */
const SETTLE_MS = 2600;
/**
 * Everything but the Avatar canvas, hidden for the capture. The captions keep
 * their layout (the page's height decides its scroll position, and so the
 * camera), hidden element by element since active ones set their own
 * visibility, and at once (some transition it).
 */
const ONLY_CANVAS = `
  .backdrop, .ambient, .bands, .cursor-trail, .hud { display: none !important; }
  .hero-layer, .hero-layer *, #overlay, #overlay * {
    visibility: hidden !important;
    transition: none !important;
  }
  html, body, .stage { background: transparent !important; }
`;

async function captureStills() {
  const outDir = path.join(stageDir, "stills");
  mkdirSync(outDir, { recursive: true });
  const stage = await startStageServer();
  const browser = await chromium.launch({
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    const stops = await stopIds(browser, stage.url);
    for (const framing of FRAMINGS)
      for (const stop of stops) {
        // A fresh page per stop, so the camera starts at that stop rather
        // than easing in from the last one.
        const page = await browser.newPage({
          viewport: { width: framing.width, height: framing.height },
          deviceScaleFactor: framing.scale,
        });
        await page.goto(`${stage.url}?stop=${stop}&nointro`);
        await page.waitForFunction(
          () => window.landingStage?.ready || window.landingStage?.error,
          null,
          { timeout: 120_000 },
        );
        const error = await page.evaluate(() => window.landingStage.error);
        if (error) throw new Error(`${stop}: ${error}`);
        await page.mouse.move(framing.width / 2, framing.height / 3);
        await page.waitForTimeout(SETTLE_MS);
        await page.addStyleTag({ content: ONLY_CANVAS });
        const png = await page.screenshot({ omitBackground: true });
        const file = path.join(outDir, `${stop}-${framing.name}.webp`);
        writeFileSync(
          file,
          await sharp(png).webp({ quality: 78, alphaQuality: 90 }).toBuffer(),
        );
        console.log(`Wrote ${path.relative(process.cwd(), file)}`);
        await page.close();
      }
  } finally {
    await browser.close();
    await stage.close();
  }
}

/** The page's stop ids, in order. */
async function stopIds(browser, url) {
  const page = await browser.newPage();
  await page.goto(`${url}?nointro`);
  await page.waitForSelector("section[id^=stop-]");
  const ids = await page.$$eval("section[id^=stop-]", (sections) =>
    sections.map((section) => section.id.slice("stop-".length)),
  );
  await page.close();
  return ids;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await captureStills();
}
