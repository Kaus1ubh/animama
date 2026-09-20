import type { Locator, Page } from "playwright/test";

import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import { readPlaybackObservation } from "../helpers/playback-observation";
import { ReadOnlyJourneyGuard } from "../helpers/preview-network";
import { openAnnieLoadoutPreview } from "../helpers/preview-surfaces";

const viewport = { width: 1600, height: 1000 };

test.use({ viewport });

/** Measure the painted background separately from the avatar's unchanged stage. */
async function expectViewportBackground(page: Page): Promise<Locator> {
  const background = page.locator(
    '[data-scene-background-scope="viewport"] [data-scene-vfx-kind="background_layers"]',
  );
  await expect(background).toHaveCount(1);
  await expect(background).toBeVisible();
  await expect
    .poll(() => background.boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      ...viewport,
    });
  return background;
}

test("accountless loadout scene fills the viewport without moving the avatar canvas", async ({
  page,
  animamaEvidence,
}) => {
  const guard = new ReadOnlyJourneyGuard(page);
  try {
    const { animaId, surface } = await openAnnieLoadoutPreview({
      contentName: "Admiration Reaction 3",
      page,
      section: "reaction",
    });
    const canvas = page.locator("canvas:visible");
    await expect(canvas).toHaveCount(1);
    await expect
      .poll(async () =>
        (await readPlaybackObservation(surface)).effects.scene.some(
          (effect) => effect.kind === "background_layers" && effect.active,
        ),
      )
      .toBe(true);
    await expectViewportBackground(page);
    const playingCanvas = await canvas.boundingBox();
    expect(playingCanvas).not.toBeNull();
    expect(playingCanvas!.x).toBeGreaterThan(0);
    expect(playingCanvas!.width).toBeLessThan(viewport.width);
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await animamaEvidence.attachBuffer(
      "loadout-full-width-scene",
      await page.screenshot({ animations: "allow" }),
      "image/png",
    );
    const observation = await readPlaybackObservation(surface);

    await page
      .getByRole("button", {
        name: "Stop Admiration Reaction 3 preview",
        exact: true,
      })
      .click();
    await expect(
      page.locator('[data-scene-background-scope="viewport"]'),
    ).toHaveCount(0);
    await expect.poll(() => canvas.boundingBox()).toEqual(playingCanvas);
    const stoppedCanvas = await canvas.boundingBox();

    await page
      .getByRole("button", {
        name: "Preview Admiration Reaction 3",
        exact: true,
      })
      .click();
    await expectViewportBackground(page);
    await expect.poll(() => canvas.boundingBox()).toEqual(playingCanvas);
    // Sidebar layout can change the stage, while scene extent remains the window.
    await page
      .getByRole("button", { name: "Close sidebar", exact: true })
      .click();
    await expectViewportBackground(page);
    await page
      .getByRole("button", { name: "Open sidebar", exact: true })
      .click();
    await expectViewportBackground(page);
    await expect.poll(() => canvas.boundingBox()).toEqual(playingCanvas);
    await animamaEvidence.attachJson("loadout-background-and-avatar-geometry", {
      viewport,
      playingCanvas,
      stoppedCanvas,
      replayedCanvas: await canvas.boundingBox(),
      observation,
    });
    await guard.verifyLoadoutUnchanged(animaId, animamaEvidence);
    await guard.assertNoMutations(animamaEvidence);
  } finally {
    await guard.dispose();
  }
});

test("accountless scene creator fills the viewport without moving the avatar canvas", async ({
  page,
  animamaEvidence,
  creatorContent,
}) => {
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  try {
    const { surface } = await openCreatorStage({ creator: "Scene VFX", page });
    const canvas = surface.locator("canvas");
    await expect(canvas).toHaveCount(1);
    const originalCanvas = await canvas.boundingBox();

    await page
      .getByRole("button", { name: "Import", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Import Scene Effect JSON",
    });
    const input = dialog.getByLabel("Creator JSON");
    const document = JSON.parse(await input.inputValue());
    document.document.name = "Viewport coverage preview";
    document.document.durationMs = 60000;
    document.document.background.solid.color = "#e5f5fa";
    await input.fill(JSON.stringify(document));
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog
      .getByRole("button", { name: "Import document", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expectViewportBackground(page);
    await expect.poll(() => canvas.boundingBox()).toEqual(originalCanvas);
    await page
      .getByRole("button", { name: "Stop preview", exact: true })
      .click();
    await expect
      .poll(async () => (await readPlaybackObservation(surface)).target.status)
      .toBe("stopped");
    await expect.poll(() => canvas.boundingBox()).toEqual(originalCanvas);
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await expect
      .poll(async () => (await readPlaybackObservation(surface)).target.status)
      .toBe("playing");
    await expectViewportBackground(page);
    await expect.poll(() => canvas.boundingBox()).toEqual(originalCanvas);
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await animamaEvidence.attachBuffer(
      "creator-full-width-scene",
      await page.screenshot({ animations: "allow" }),
      "image/png",
    );
    await animamaEvidence.attachJson("creator-background-and-avatar-geometry", {
      viewport,
      originalCanvas,
      playingCanvas: await canvas.boundingBox(),
      observation: await readPlaybackObservation(surface),
    });
    await guard.assertNoMutations(animamaEvidence);
    await creatorContent.assertLocalCatalogUnchanged(
      catalogBefore,
      animamaEvidence,
      "scene-layout-preview",
    );
  } finally {
    await guard.dispose();
  }
});
