import type { Locator, Page } from "playwright/test";

import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  OBSERVATION_SAMPLE_INTERVAL_MS,
  readPlaybackObservation,
  type PlaybackObservation,
} from "../helpers/playback-observation";
import { ReadOnlyJourneyGuard } from "../helpers/preview-network";
import {
  openAnnieLoadoutPreview,
  prepareLibraryPreview,
} from "../helpers/preview-surfaces";

const viewport = { width: 1600, height: 1000 };

test.use({ viewport });

test("accountless avatar effect Library Edit keeps Eye = playing through creator rerenders", async ({
  page,
  animamaEvidence,
  creatorContent,
}) => {
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  const samples: PlaybackObservation[] = [];
  try {
    await prepareLibraryPreview({
      contentName: "Eye =",
      page,
      section: "avatar",
    });
    await page
      .getByRole("article", { name: "Eye =", exact: true })
      .getByRole("link", { name: "Edit", exact: true })
      .click();
    await expect(page).toHaveURL(/\/a\/avatar-effects\/[^/?#]+/);
    const surface = page.locator('[data-playback-surface="creator-stage"]');
    await expect(surface).toHaveCount(1);
    await expect
      .poll(
        async () => (await readPlaybackObservation(surface)).target.status,
        {
          timeout: 30_000,
        },
      )
      .toBe("playing");

    // A single Playing snapshot can catch the flicker. Require sustained
    // activation across unrelated parent renders and an explicit stop/replay.
    for (const phase of ["initial", "guides", "replay"]) {
      if (phase === "guides") {
        await page
          .getByRole("switch", { name: "Show placement guides", exact: true })
          .click();
      } else if (phase === "replay") {
        await page
          .getByRole("button", { name: "Stop preview", exact: true })
          .click();
        await expect
          .poll(async () => {
            const observation = await readPlaybackObservation(surface);
            return {
              status: observation.target.status,
              effects: observation.effects.avatar.length,
            };
          })
          .toEqual({ status: "stopped", effects: 0 });
        await page
          .getByRole("button", { name: "Play preview", exact: true })
          .click();
        await expect
          .poll(
            async () => (await readPlaybackObservation(surface)).target.status,
          )
          .toBe("playing");
      }
      for (let index = 0; index < 10; index += 1) {
        await page.waitForTimeout(OBSERVATION_SAMPLE_INTERVAL_MS);
        const observation = await readPlaybackObservation(surface);
        samples.push(observation);
        expect(observation.target, phase).toEqual({
          kind: "avatar_vfx",
          runtimeId: "Eye =",
          status: "playing",
        });
        expect(observation.effects.avatar, phase).toHaveLength(1);
        expect(observation.effects.avatar[0], phase).toMatchObject({
          runtimeId: "avatar-effect-editor-preview",
          active: true,
        });
        expect(observation.diagnostics, phase).toEqual([]);
      }
    }
  } finally {
    await animamaEvidence.attachJson(
      "avatar-effect-editor-stable-playback",
      samples,
    );
    try {
      await guard.assertNoMutations(animamaEvidence);
      await creatorContent.assertLocalCatalogUnchanged(
        catalogBefore,
        animamaEvidence,
        "avatar-effect-editor-preview",
      );
    } finally {
      await guard.dispose();
    }
  }
});

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
