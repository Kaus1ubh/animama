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

/** Avatar and Scene share compact transport without a separate timeline footer. */
async function expectCompactTransport(page: Page): Promise<void> {
  const controls = page.getByRole("group", {
    name: "Preview controls",
    exact: true,
  });
  await expect(controls).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Collapse|Expand) preview$/i }),
  ).toHaveCount(0);
  await expect(page.getByTitle("Restart preview", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    controls.getByRole("button", { name: "Restart preview", exact: true }),
  ).toHaveCount(1);
  const desktopBounds = await controls.boundingBox();
  expect(desktopBounds!.y).toBeGreaterThan(viewport.height / 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await controls.scrollIntoViewIfNeeded();
  const narrowBounds = await controls.boundingBox();
  expect(narrowBounds!.x).toBeGreaterThanOrEqual(0);
  expect(narrowBounds!.x + narrowBounds!.width).toBeLessThanOrEqual(390);
  await controls
    .getByRole("button", { name: "Stop preview", exact: true })
    .click();
  const play = controls.getByRole("button", {
    name: "Play preview",
    exact: true,
  });
  await play.focus();
  await page.keyboard.press("Enter");
  await expect(
    controls.getByRole("button", { name: "Pause preview", exact: true }),
  ).toBeVisible();
  await controls
    .getByRole("button", { name: "Restart preview", exact: true })
    .click();
  await page.setViewportSize(viewport);
}

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
    await expect(page).toHaveURL(/\/avatar-effects\/[^/?#]+/);
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
        // The UV popover dismisses on the outside Guides click, like any
        // popover; it must stay available and reopen while Guides is off.
        await guidesToggle.click();
        await expect(guidesToggle).not.toBeChecked();
        await expect(guides).toBeHidden();
        await expect(uvPanel).toBeHidden();
        await expect(uvButton).toBeVisible();
        await uvButton.click();
        await expect(uvPanel.getByRole("img")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(uvPanel).toBeHidden();
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
    await expectCompactTransport(page);
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
  await page.emulateMedia({ reducedMotion: "reduce" });
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
    const positionX = page
      .getByText("Position Offset", { exact: true })
      .locator("..")
      .getByRole("spinbutton", { name: "X", exact: true });
    await positionX.fill("");
    await expect(positionX).toHaveValue("");
    await positionX.pressSequentially("-0.25");
    await expect(positionX).toHaveValue("-0.25");
    await positionX.press("Enter");
    const positioned = JSON.parse(await readPortableJson());
    expect(positioned.document.transform.offset.x).toBe(-0.25);
    await positionX.fill("");
    await expect(positionX).toHaveValue("");
    await positionX.blur();
    await expect(positionX).toHaveValue("-0.25");
    expect(
      JSON.parse(await readPortableJson()).document.transform.offset.x,
    ).toBe(-0.25);
    await positionX.fill("-0.251");
    await expect(positionX).toHaveValue("-0.251");
    await positionX.press("Enter");
    await expect(positionX).toHaveValue("-0.25");
    await positionX.fill("0.4");
    await positionX.blur();
    await page.getByRole("button", { name: /^Undo ·/ }).click();
    await expect(positionX).toHaveValue("-0.25");
    await positionX.fill("");
    await positionX.pressSequentially("-0.25e");
    // Native number inputs expose incomplete exponents as an empty value.
    await expect(positionX).toHaveValue("");
    await positionX.blur();
    await expect(positionX).toHaveValue("-0.25");
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
    expect(
      await guides.evaluate((canvas) => ({
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animations: canvas.getAnimations({ subtree: true }).length,
      })),
    ).toEqual({ reducedMotion: true, animations: 0 });
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

test("accountless vfx guides retain Particle Avatar and Outline controls", async ({
  page,
  animamaEvidence,
  creatorContent,
}) => {
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  try {
    const { surface } = await openCreatorStage({
      creator: "Particle VFX",
      page,
    });
    const avatar = page.getByRole("switch", {
      name: "Show Avatar",
      exact: true,
    });
    const outline = page.getByRole("switch", {
      name: "Show emitter shape outline",
      exact: true,
    });
    await expect(avatar).toBeChecked();
    await expect(outline).toBeChecked();
    await avatar.uncheck();
    await expect(avatar).not.toBeChecked();
    await expect(outline).toBeChecked();
    await outline.uncheck();
    await expect(outline).not.toBeChecked();
    await expect(avatar).not.toBeChecked();
    await avatar.check();
    await expect(avatar).toBeChecked();
    await expect(outline).not.toBeChecked();
    await outline.check();
    await expect(outline).toBeChecked();
    // The Particle timeline ends naturally while controls are exercised.
    await page
      .getByRole("button", { name: "Restart effect preview", exact: true })
      .click();
    await expect
      .poll(
        async () => (await readPlaybackObservation(surface)).target.status,
        { timeout: 30_000 },
      )
      .toBe("playing");
    await animamaEvidence.attachJson(
      "particle-retained-preview-controls",
      await readPlaybackObservation(surface),
    );
  } finally {
    try {
      await guard.assertNoMutations(animamaEvidence);
      await creatorContent.assertLocalCatalogUnchanged(
        catalogBefore,
        animamaEvidence,
        "particle-retained-preview-controls",
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
    await expect(
      page.getByRole("switch", { name: "Show placement guides", exact: true }),
    ).toHaveCount(0);
    for (const name of ["Preview model", "Preview view"]) {
      await expect(
        page.getByRole("combobox", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page
        .getByRole("group", { name: "Preview controls", exact: true })
        .getByRole("button", { name: "Restart preview", exact: true }),
    ).toBeEnabled();
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
    page.on("dialog", (confirmation) => confirmation.accept());
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
    await page
      .locator('input[type="file"][accept*="image/svg+xml"]')
      .setInputFiles({
        name: "static-guide-check.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e65599"/><circle cx="20" cy="10" r="7" fill="#ffffff"/></svg>',
        ),
      });
    const svgCell = page
      .locator(
        '[data-scene-vfx-kind="background_layers"] [data-scene-vfx-item-id^="private-"]',
      )
      .first();
    await expect(svgCell).toBeVisible();
    // Scene images render as CSS backgrounds. Decode that displayed resource
    // to prove the uploaded SVG is usable, rather than just a listed filename.
    const svgDimensions = await svgCell.evaluate(async (cell) => {
      const background = getComputedStyle(cell).backgroundImage;
      const source = /^url\("?(.*?)"?\)$/.exec(background)?.[1];
      if (!source)
        throw new Error("Uploaded SVG has no rendered background image.");
      const image = new Image();
      image.src = source;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(svgDimensions).toEqual({ width: 40, height: 20 });
    await expect(
      page.getByRole("switch", { name: "Show placement guides", exact: true }),
    ).toHaveCount(0);
    // Import through the supported editor surface, then exercise the actual
    // coordinate input and rendered polygons rather than deleted guide boxes.
    document.document.kind = "focus_lines";
    document.document.focus.target = {
      kind: "manual_box",
      rect: { x: 0.25, y: 0.2, width: 0.3, height: 0.4 },
    };
    await page
      .getByRole("button", { name: "Import", exact: true })
      .first()
      .click();
    await dialog.getByLabel("Creator JSON").fill(JSON.stringify(document));
    await dialog
      .getByRole("button", { name: "Import document", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const polygon = page
      .locator('[data-scene-vfx-kind="focus_lines"] polygon')
      .first();
    await expect(polygon).toBeVisible();
    const originalPoints = await polygon.getAttribute("points");
    await page.getByRole("spinbutton", { name: "X", exact: true }).fill("0.5");
    await expect(polygon).not.toHaveAttribute("points", originalPoints!);
    await expect(
      page.getByRole("switch", { name: "Show placement guides", exact: true }),
    ).toHaveCount(0);
    await expectCompactTransport(page);
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
