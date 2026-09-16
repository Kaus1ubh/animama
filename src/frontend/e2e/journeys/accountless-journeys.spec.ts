import type { Response } from "playwright/test";
import { expect, test } from "../fixtures/animama";
import { selectAnnieFromSidebar } from "../helpers/preview-surfaces";
import { openCreatorStage } from "../helpers/creator-surfaces";
import { readPlaybackObservation } from "../helpers/playback-observation";
import { CreatorMutationGuard } from "../helpers/preview-network";

/** Hold one browser request before transport; the next request uses real FastAPI. */
test("accountless selection, Stop and subsequent persisted reply", async ({
  page,
  animamaEvidence,
}) => {
  await selectAnnieFromSidebar(page);
  const input = page.getByPlaceholder("What's on your mind?");
  await expect(input).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  let complete!: () => void;
  const handled = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const routePattern = "**/v1/animas/*/chat:sse";
  await page.route(
    routePattern,
    async (route) => {
      intercepted = true;
      await gate;
      try {
        await route.abort("aborted");
      } finally {
        complete();
      }
    },
    { times: 1 },
  );
  try {
    await input.fill("Cancel this fixture request");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect.poll(() => intercepted).toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
    await handled;
    await page.unroute(routePattern);
  }
  const prompt = `Browser recovery ${Date.now()}`;
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText(`Mock response to ${prompt}`, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page.locator('a[href*="/c/"]').first().click();
  await expect(page).toHaveURL(/\/a\/[^/]+\/c\/[^/?]+/);
  await page.reload();
  await expect(
    page.getByText(`Mock response to ${prompt}`, { exact: true }),
  ).toBeVisible();
  await animamaEvidence.attachJson("chat-stop-and-recovery", {
    selectedThroughSidebar: true,
    stoppedBeforeServerDispatch: true,
    subsequentReplyFromActualDeterministicBackend: true,
    replySurvivedReload: true,
    limitation:
      "Browser route gate proves rendered Stop recovery, not server disconnect cleanup (covered by transport tests).",
  });
});

/** Import editor JSON through the real dialog; preview stays transient until Save. */
test("accountless Scene JSON import, preview, save and owned cleanup", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  const typedReads: Array<{ status: number }> = [];
  const recordTypedRead = (response: Response) => {
    if (
      response.request().method() === "GET" &&
      /^\/v1\/scene-effects\/[^/]+$/.test(new URL(response.url()).pathname)
    ) {
      typedReads.push({ status: response.status() });
    }
  };
  const name = `p8-scene-${Date.now()}`;
  const logicalKey = `local:scene-effect:${name}`;
  const before = await creatorContent.snapshotLocalCatalog();
  await creatorContent.preflightContentAbsence({
    logicalKey,
    expectedRelativePath: `vfx/scene/${name}`,
  });
  const animaId = await selectAnnieFromSidebar(page);
  const loadout = await creatorContent.snapshotAnimaLoadout(animaId);
  const plan = await creatorContent.planContent({
    journeyKey: "accountless-scene-json",
    kind: "scene_effect",
    entryName: name,
    logicalKey,
  });
  const guard = await CreatorMutationGuard.attach(
    page,
    process.env.ANIMAMA_E2E_API_URL!,
  );
  try {
    const stage = await openCreatorStage({
      creator: "Scene VFX",
      page,
      selectAnnie: false,
    });
    await page
      .getByRole("button", { name: "Import", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Import Scene Effect JSON",
    });
    const jsonInput = dialog.getByLabel("Creator JSON");
    const document = JSON.parse(await jsonInput.inputValue());
    expect(document.schema).toBe("animama/scene-effect-editor/1");
    document.document.name = name;
    document.document.background.solid.color = "#13579b";
    await jsonInput.fill(JSON.stringify(document));
    page.once("dialog", async (confirmation) => {
      await confirmation.accept();
    });
    await dialog
      .getByRole("button", { name: "Import document", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Stop preview", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readPlaybackObservation(stage.surface)).target.status,
      )
      .toBe("stopped");
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readPlaybackObservation(stage.surface)).target.status,
      )
      .toBe("playing");
    await creatorContent.assertLocalCatalogUnchanged(
      before,
      animamaEvidence,
      "import-preview-before-save",
    );
    guard.armSave({
      family: "scene-effects",
      entryName: name,
      logicalKey,
      recordOwned: (owned) => creatorContent.recordOwnedContent(plan, owned),
    });
    // Keep every typed read from Save through reload visible: retries must not hide 404s.
    page.on("response", recordTypedRead);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    const owned = await guard.waitForOwned();
    await creatorContent.verifyOwnedContent(plan, owned);
    await expect(page).toHaveURL(
      new RegExp(`/a/scene-effects/${owned.itemId}/edit`),
    );
    const hydratedFromBackend = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/v1/scene-effects/${owned.itemId}` &&
        response.request().method() === "GET" &&
        response.ok(),
    );
    await page.reload();
    const hydrated = await (await hydratedFromBackend).json();
    expect(hydrated.item_id).toBe(owned.itemId);
    expect(hydrated.revision_sha256).toBe(owned.revisionSha256);
    await expect(
      page.getByRole("button", { name: "JSON", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    const saved = JSON.parse(
      await page.getByRole("dialog").locator("textarea").inputValue(),
    );
    expect(saved.document.name).toBe(name);
    expect(saved.document.background.solid.color).toBe("#13579b");
    await page.keyboard.press("Escape");
    expect(typedReads.length).toBeGreaterThan(0);
    expect(typedReads.filter(({ status }) => status >= 400)).toEqual([]);
    await animamaEvidence.attachJson("scene-save-typed-reads", typedReads);
    await creatorContent.assertAnimaLoadoutUnchanged(loadout, animamaEvidence);
    await page.goto("/a/library");
    await creatorContent.cleanupOwnedContent();
    await creatorContent.assertDeletedContent(plan, owned);
    await creatorContent.assertLocalCatalogUnchanged(
      before,
      animamaEvidence,
      "after-owned-cleanup",
    );
  } finally {
    page.off("response", recordTypedRead);
    await guard.assertPolicy(animamaEvidence);
    await guard.dispose();
  }
});

/** Real layout and hit testing are required; DOM-only rendering cannot detect occlusion. */
for (const creator of ["scene", "avatar", "particle"] as const) {
  test(`${creator} creator health and Save remain independently reachable`, async ({
    page,
    animamaEvidence,
  }) => {
    await selectAnnieFromSidebar(page);
    await page.goto(`/a/${creator}-effects/new`);
    if (creator === "avatar") {
      // An original image makes Save actionable; choosing it only creates a local draft.
      const image = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 2;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#13579b";
        context.fillRect(0, 0, 2, 2);
        return canvas.toDataURL("image/png").split(",")[1]!;
      });
      await page
        .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
        .setInputFiles({
          name: "toolbar-layout.png",
          mimeType: "image/png",
          buffer: Buffer.from(image, "base64"),
        });
    }
    const save = page.getByRole("button", { name: "Save", exact: true });
    const health = page.getByRole("status").filter({
      has: page.getByRole("button", { name: /View content health details/ }),
    });
    const details = health.getByRole("button", {
      name: /View content health details/,
    });
    const rescan = health.getByRole("button", {
      name: "Rescan content library",
    });
    await expect(save).toBeEnabled({ timeout: 30_000 });
    if (creator === "avatar") {
      // Choosing an image asynchronously restarts preview. Stop only after its draft is ready.
      await expect(
        page.getByText("toolbar-layout.png", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Stop preview", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Play preview", exact: true }),
      ).toBeVisible();
    }
    await expect(health).toBeVisible();
    const measurements: unknown[] = [];
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      // Previous trial clicks hover controls. Resize must start with no stale tooltip.
      await page.mouse.move(width - 1, 899);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(save).toBeInViewport();
      const saveRect = await save.boundingBox();
      const healthRect = await health.boundingBox();
      expect(saveRect).not.toBeNull();
      expect(healthRect).not.toBeNull();
      if (!saveRect || !healthRect)
        throw new Error("Creator controls lost their layout.");
      const intersect =
        saveRect.x < healthRect.x + healthRect.width &&
        saveRect.x + saveRect.width > healthRect.x &&
        saveRect.y < healthRect.y + healthRect.height &&
        saveRect.y + saveRect.height > healthRect.y;
      expect(intersect).toBe(false);
      // Hit testing and normal actionability must both hold for valid drafts.
      await expect
        .poll(() =>
          save.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await save.click({ trial: true });
      await details.click({ trial: true });
      await rescan.click({ trial: true });
      measurements.push({ width, saveRect, healthRect, intersect });
      if (width === 768 || width === 390) {
        await page.mouse.move(width - 1, 899);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await animamaEvidence.attachBuffer(
          `${creator}-toolbar-${width}`,
          await page.screenshot(),
          "image/png",
        );
      }
    }
    await animamaEvidence.attachJson(`${creator}-toolbar-layout`, measurements);
  });
}
