import type { Page } from "playwright/test";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

import { expect, test } from "../fixtures/animama";
import {
  commitSharingPackage,
  downloadSharingPackage,
  reviewSharingExport,
  uploadSharingPackage,
} from "../helpers/content-sharing";
import { CreatorMutationGuard } from "../helpers/preview-network";
import {
  openLibraryPreview,
  selectAnnieFromSidebar,
} from "../helpers/preview-surfaces";

/**
 * Scene layer capabilities (R2): a Scene Effect using every optional layer
 * (gradient, tile, rays, scatter with a private image, entry flash) is built
 * in the creator, saved, reopened from the backend, drawn in the Library
 * preview dock, and survives a Portable package round trip. The uploaded PNGs
 * keep `.png` names.
 */

/** A coloured disc on transparency, `size` pixels square. */
function disc(size: number, colour: string): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.4}" fill="${colour}"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

/** A layer card in the Scene Setup panel, by its title. */
function layerCard(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title} `) });
}

/** The Scene layers drawn in `scope`, by their `data-scene-vfx-layer`. */
async function drawnLayers(scope: ReturnType<Page["locator"]>) {
  return scope
    .locator("[data-scene-vfx-layer]")
    .evaluateAll((layers) =>
      [
        ...new Set(
          layers.map((layer) => layer.getAttribute("data-scene-vfx-layer")),
        ),
      ].sort(),
    );
}

const EXPECTED_LAYERS = [
  "flash",
  "gradient",
  "pattern",
  "rays",
  "scatter",
  "tile",
];

test("accountless Scene layers save, reopen, preview and travel in packages", async ({
  page,
  creatorContent,
  animamaEvidence,
}, testInfo) => {
  test.setTimeout(240_000);
  const runId = process.env.ANIMAMA_E2E_RUN_ID;
  if (!runId)
    throw new Error("The isolated E2E runner environment is required.");
  const name = `scene-layers-${runId}`;
  const logicalKey = `local:scene-effect:${name}`;
  const tileFile = testInfo.outputPath("bokeh.png");
  const petalFile = testInfo.outputPath("petal.png");
  await writeFile(tileFile, await disc(96, "#ffffff"));
  await writeFile(petalFile, await disc(64, "#ff5c93"));
  const before = await creatorContent.snapshotLocalCatalog();
  await creatorContent.preflightContentAbsence({
    logicalKey,
    expectedRelativePath: `vfx/scene/${name}`,
  });
  await selectAnnieFromSidebar(page);
  const plan = await creatorContent.planContent({
    journeyKey: `accountless-scene-layers-${runId}`,
    kind: "scene_effect",
    entryName: name,
    logicalKey,
  });
  // The creator may only Save; the package round trip runs after it.
  const guard = await CreatorMutationGuard.attach(
    page,
    process.env.ANIMAMA_E2E_API_URL!,
  );
  let owned: Awaited<ReturnType<typeof guard.waitForOwned>>;
  try {
    await test.step("build every optional layer in the creator", async () => {
      await page.goto("/scene-effects/new");
      for (const layer of ["Gradient", "Screen", "Entry flash"])
        await page
          .getByRole("switch", { name: `${layer} enabled`, exact: true })
          .click();
      await layerCard(page, "Tile").click();
      await page
        .getByLabel("Choose tile image", { exact: true })
        .setInputFiles(tileFile);
      await expect(layerCard(page, "Tile")).toContainText("bokeh.png");
      await page
        .getByRole("button", { name: "Add scatter layer", exact: true })
        .click();
      await page
        .getByLabel("Add private image", { exact: true })
        .setInputFiles(petalFile);
      await expect(layerCard(page, "Scatter 1")).toContainText("1 item ·");
      await page
        .getByRole("textbox", { name: "Scene FX name", exact: true })
        .fill(name);
      await expect
        .poll(() => drawnLayers(page.locator("body")))
        .toEqual(EXPECTED_LAYERS);
      await animamaEvidence.attachBuffer(
        "scene-layers-creator",
        await page.screenshot({ animations: "allow" }),
        "image/png",
      );
    });

    owned = await test.step("save as Local content", async () => {
      guard.armSave({
        family: "scene-effects",
        entryName: name,
        logicalKey,
        recordOwned: (owned) => creatorContent.recordOwnedContent(plan, owned),
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const owned = await guard.waitForOwned();
      await creatorContent.verifyOwnedContent(plan, owned);
      await expect(page).toHaveURL(
        new RegExp(`/scene-effects/${owned.itemId}/edit`),
      );
      return owned;
    });

    await test.step("reopen restores every layer from the backend", async () => {
      await page.reload();
      await expect(layerCard(page, "Tile")).toContainText("bokeh.png");
      await expect(layerCard(page, "Scatter 1")).toContainText("1 item ·");
      await expect
        .poll(() => drawnLayers(page.locator("body")))
        .toEqual(EXPECTED_LAYERS);
    });

    await test.step("the Library preview dock draws the layers", async () => {
      const dock = await openLibraryPreview({
        page,
        section: "scene",
        origin: "Mine",
        contentName: name,
        selectAnnie: false,
      });
      await expect.poll(() => drawnLayers(dock)).toEqual(EXPECTED_LAYERS);
      await animamaEvidence.attachBuffer(
        "scene-layers-preview-dock",
        await page.screenshot({ animations: "allow" }),
        "image/png",
      );
    });

    expect(owned.itemId).toBeTruthy();
  } finally {
    await guard.assertPolicy(animamaEvidence);
    await guard.dispose();
  }

  await test.step("a Portable package round trip keeps the layers", async () => {
    await page.goto("/library");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Search content", exact: true })
      .fill(name);
    await page.getByRole("checkbox", { name, exact: true }).check();
    await reviewSharingExport(page);
    const archive = await downloadSharingPackage(
      page,
      testInfo,
      page.getByRole("button", { name: "Download package", exact: true }),
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const review = await uploadSharingPackage(page, archive);
    expect(review.items.map((item) => item.name)).toEqual([`${name}-2`]);
    const [imported] = await commitSharingPackage({
      page,
      content: creatorContent,
      review,
      journeyKey: `scene-layers-import-${runId}`,
    });
    await page.goto(`/scene-effects/${imported!.itemId}/edit`);
    await expect(layerCard(page, "Tile")).toContainText("bokeh.png");
    await expect
      .poll(() => drawnLayers(page.locator("body")))
      .toEqual(EXPECTED_LAYERS);
  });

  await page.goto("/library");
  await creatorContent.cleanupOwnedContent();
  await creatorContent.assertLocalCatalogUnchanged(
    before,
    animamaEvidence,
    "scene-layers",
  );
});
