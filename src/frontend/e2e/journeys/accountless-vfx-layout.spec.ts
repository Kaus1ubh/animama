import type { Locator, Page } from "playwright/test";

import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  OBSERVATION_SAMPLE_INTERVAL_MS,
  parsePlaybackObservation,
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

test("accountless avatar effect vfx guides keep Eye = playing through creator rerenders", async ({
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
    const guides = page.getByTestId("avatar-effect-placement-guides");
    const guidesToggle = page.getByRole("switch", {
      name: "Show placement guides",
      exact: true,
    });
    await expect(guidesToggle).toBeChecked();
    await expect(guides).toHaveAttribute("data-guide-count", "2");
    await expect(guides).toHaveAttribute("data-artwork-count", "2");
    await expect(guides).toHaveAttribute(
      "aria-label",
      /left.*right|right.*left/i,
    );
    const initialEffect = (await readPlaybackObservation(surface)).effects
      .avatar[0];
    expect(initialEffect?.active).toBe(true);
    expect(initialEffect?.runtimeId).toBeTruthy();
    const uvButton = page.getByRole("button", {
      name: "UV preview",
      exact: true,
    });
    const uvPanel = page.getByRole("dialog", {
      name: "UV preview",
      exact: true,
    });
    await expect(uvButton).toBeVisible();
    await expect(uvPanel).toBeHidden();

    // A single Playing snapshot can catch the flicker. Require sustained
    // activation across unrelated parent renders and an explicit stop/replay.
    for (const phase of [
      "initial",
      "uv",
      "guides-off",
      "guides-on",
      "replay",
    ]) {
      if (phase === "uv") {
        await uvButton.click();
        await expect(uvPanel).toBeVisible();
        await expect(
          uvPanel.getByRole("img", {
            name: /texture with selected placement guides/,
          }),
        ).toBeVisible();
        await uvPanel
          .getByRole("checkbox", { name: "Skin coverage", exact: true })
          .check();
      } else if (phase === "guides-off") {
        await guidesToggle.click();
        await expect(guidesToggle).not.toBeChecked();
        await expect(guides).toBeHidden();
        await expect(uvPanel).toBeHidden();
        await expect(uvButton).toBeHidden();
      } else if (phase === "guides-on") {
        await guidesToggle.click();
        await expect(guidesToggle).toBeChecked();
        await expect(guides).toBeVisible();
        await expect(guides).toHaveAttribute("data-guide-count", "2");
        await expect(guides).toHaveAttribute("data-artwork-count", "2");
        await expect(uvButton).toBeVisible();
        await expect(uvPanel).toBeHidden();
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
        await expect(guides).toHaveAttribute("data-guide-count", "2");
        await expect(guides).toHaveAttribute("data-artwork-count", "0");
        await page
          .getByRole("button", { name: "Play preview", exact: true })
          .click();
        await expect
          .poll(
            async () => (await readPlaybackObservation(surface)).target.status,
          )
          .toBe("playing");
      }
      // Collect the bounded window in one browser call. Separate protocol
      // round trips per field become seconds apart under software WebGL.
      const window = await surface
        .locator("output[data-playback-observation]")
        .evaluate(async (output, interval) => {
          const readings: string[] = [];
          for (let index = 0; index < 10; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, interval));
            readings.push(output.textContent ?? "");
          }
          return readings;
        }, OBSERVATION_SAMPLE_INTERVAL_MS);
      for (const reading of window) {
        const observation = parsePlaybackObservation(JSON.parse(reading));
        samples.push(observation);
        expect(observation.target, phase).toEqual({
          kind: "avatar_vfx",
          runtimeId: "Eye =",
          status: "playing",
        });
        expect(observation.effects.avatar, phase).toHaveLength(1);
        expect(observation.effects.avatar[0], phase).toMatchObject({
          runtimeId: initialEffect!.runtimeId,
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

test("accountless vfx guides preserve authored JSON with replacement artwork and animation", async ({
  page,
  animamaEvidence,
  creatorContent,
}) => {
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  const readPortableJson = async () => {
    await page.getByRole("button", { name: "View JSON", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Portable Avatar Effect JSON",
      exact: true,
    });
    const text = await dialog.getByRole("textbox").inputValue();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    return text;
  };
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
    const surface = page.locator('[data-playback-surface="creator-stage"]');
    await expect(
      surface.locator("output[data-playback-observation]"),
    ).toHaveCount(1);
    await expect
      .poll(
        async () => (await readPlaybackObservation(surface)).target.status,
        { timeout: 30_000 },
      )
      .toBe("playing");
    // A small, non-square PNG keeps this fixture independent of catalog artwork.
    await page
      .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
      .setInputFiles({
        name: "guide-check-32x16.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAJElEQVR4nGP4H7Dg/0BihlEHjDpg1AGjDhh1wKgDRh0w0A4AAPph3Ey+VSaIAAAAAElFTkSuQmCC",
          "base64",
        ),
      });
    await expect(
      page.getByText("guide-check-32x16.png", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Animation", exact: true }).click();
    for (const name of ["Pulse", "Spin", "Drift"]) {
      await page.getByRole("switch", { name, exact: true }).check();
    }
    await expect(
      page.getByRole("button", { name: "Unsaved", exact: true }),
    ).toBeVisible();
    const before = await readPortableJson();
    const guides = page.getByTestId("avatar-effect-placement-guides");
    await expect(guides).toHaveAttribute("data-artwork-count", "2");
    const first = await readPlaybackObservation(surface);
    const firstGuideImage = await guides.evaluate((canvas: HTMLCanvasElement) =>
      canvas.toDataURL(),
    );
    await page.getByRole("button", { name: "UV preview", exact: true }).click();
    const uv = page.getByRole("dialog", { name: "UV preview", exact: true });
    await expect(uv.getByRole("img")).toBeVisible();
    await uv
      .getByRole("checkbox", { name: "Skin coverage", exact: true })
      .check();
    await page.keyboard.press("Escape");
    const toggle = page.getByRole("switch", {
      name: "Show placement guides",
      exact: true,
    });
    await toggle.uncheck();
    await expect(guides).toBeHidden();
    await toggle.check();
    await expect(guides).toHaveAttribute("data-artwork-count", "2");
    const after = await readPortableJson();
    expect(after).toBe(before);
    await expect(
      page.getByRole("button", { name: "Unsaved", exact: true }),
    ).toBeVisible();
    const last = await readPlaybackObservation(surface);
    expect(last.target.status).toBe("playing");
    expect(last.effects.avatar).toHaveLength(1);
    // Avatar effect observations do not expose their animation clock.
    // Read the visible guide pixels to prove its live geometry moved instead.
    const lastGuideImage = await guides.evaluate((canvas: HTMLCanvasElement) =>
      canvas.toDataURL(),
    );
    expect(lastGuideImage).not.toBe(firstGuideImage);
    expect(last.diagnostics).toEqual([]);
    await animamaEvidence.attachJson("vfx-guides-authored-state", {
      before,
      after,
      first,
      last,
    });
  } finally {
    try {
      await guard.assertNoMutations(animamaEvidence);
      await creatorContent.assertLocalCatalogUnchanged(
        catalogBefore,
        animamaEvidence,
        "vfx-guides-authored-state",
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
