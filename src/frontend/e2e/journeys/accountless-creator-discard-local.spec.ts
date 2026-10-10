import { expect, test } from "../fixtures/animama";
import {
  discardToLibrary,
  readPortableJson,
} from "../helpers/creator-surfaces";
import {
  CreatorMutationGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import {
  prepareLibraryPreview,
  selectAnnieFromSidebar,
} from "../helpers/preview-surfaces";

for (const failure of [false, true]) {
  test(`accountless Local Gesture discard ${failure ? "storage failure preserves recovery" : "reopens saved content"}`, async ({
    page,
    creatorContent,
    animamaEvidence,
  }) => {
    const runId = process.env.ANIMAMA_E2E_RUN_ID;
    const apiUrl = process.env.ANIMAMA_E2E_API_URL;
    if (!runId || !apiUrl)
      throw new Error("The isolated E2E runner environment is required.");
    const name = `discard-gesture-${failure ? "failure" : "normal"}-${runId}`;
    const logicalKey = `local:gesture:${name}`;
    const catalogBefore = await creatorContent.snapshotLocalCatalog();
    await creatorContent.preflightContentAbsence({
      logicalKey,
      expectedRelativePath: `gestures/${name}`,
    });
    const plan = await creatorContent.planContent({
      journeyKey: `local-gesture-discard-${failure ? "failure" : "normal"}`,
      kind: "gesture",
      entryName: name,
      logicalKey,
    });
    // Visiting Annie may persist her as the last active Anima. Do that before
    // the guard so it limits only this journey's creator writes.
    await selectAnnieFromSidebar(page);
    const guard = await CreatorMutationGuard.attach(page, apiUrl);
    let owned: CreatorOwnedResponse | null = null;
    try {
      await prepareLibraryPreview({
        contentName: "Have an Idea",
        page,
        section: "gesture",
        selectAnnie: false,
      });
      await page
        .getByRole("article", { name: "Have an Idea", exact: true })
        .getByRole("link", { name: "Edit", exact: true })
        .click();
      const nameInput = page.getByRole("textbox", {
        name: "gesture name",
        exact: true,
      });
      await expect(nameInput).toHaveValue("Have an Idea Custom");
      await nameInput.fill(name);
      guard.armSave({
        family: "gestures",
        entryName: name,
        logicalKey,
        recordOwned: (identity) =>
          creatorContent.recordOwnedContent(plan, identity),
      });
      await page
        .getByRole("button", { name: "Save content", exact: true })
        .click();
      owned = await guard.waitForOwned();
      await expect(page).toHaveURL(
        new RegExp(`/gestures/${owned.itemId}/edit`),
      );
      await expect(nameInput).toHaveValue(name);
      await expect(
        page.getByRole("status", { name: "Saved", exact: true }),
      ).toBeVisible();
      const savedJson = await readPortableJson(page, "Creator JSON");
      await nameInput.fill(`${name}-discarded`);
      await expect(
        page.getByRole("status", { name: "Unsaved", exact: true }),
      ).toBeVisible();
      await page.waitForTimeout(700);
      if (failure) {
        // Fail browser recovery deletion once without touching canonical content.
        await page.evaluate(() => {
          const original = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key: string) {
            if (key.startsWith("animama:action-editor:")) {
              Storage.prototype.removeItem = original;
              throw new Error("Injected recovery deletion failure");
            }
            return original.call(this, key);
          };
        });
        await page.getByRole("link", { name: "Library", exact: true }).click();
        const dialog = page.getByRole("dialog", {
          name: "Discard authoring changes?",
          exact: true,
        });
        await dialog
          .getByRole("button", { name: "Discard and continue", exact: true })
          .click();
        await expect(dialog).toBeVisible();
        await expect(
          page.getByText(
            /Injected recovery deletion failure|could not.*recovery|could not.*discard/i,
          ),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Stay", exact: true }).click();
        await nameInput.fill(`${name}-retry`);
        await page.waitForTimeout(700);
        page.once("dialog", (confirmation) => confirmation.accept());
        await page.reload();
        await expect(nameInput).toHaveValue(`${name}-retry`);
      }
      await discardToLibrary(page);
      await prepareLibraryPreview({
        contentName: name,
        origin: "Mine",
        page,
        section: "gesture",
      });
      await page
        .getByRole("article", { name, exact: true })
        .getByRole("link", { name: "Edit", exact: true })
        .click();
      await expect(nameInput).toHaveValue(name);
      expect(await readPortableJson(page, "Creator JSON")).toBe(savedJson);
      // The item/revision pair proves unsaved changes never reached canonical content.
      await creatorContent.verifyOwnedContent(plan, owned);
      await animamaEvidence.attachJson(
        "local-gesture-discard-saved-revision",
        owned,
      );
    } finally {
      try {
        if (owned) guard.armDelete(owned);
        const cleanup = await creatorContent.cleanupOwnedContent();
        if (owned) {
          guard.recordExternalDelete(owned);
          expect(cleanup).toMatchObject({
            attempted: 1,
            deleted: 1,
            failed: 0,
          });
          await creatorContent.assertDeletedContent(plan, owned);
        }
        await creatorContent.assertLocalCatalogUnchanged(
          catalogBefore,
          animamaEvidence,
          "local-gesture-discard-cleanup",
        );
        await guard.assertPolicy(animamaEvidence);
      } finally {
        await guard.dispose();
      }
    }
  });
}
