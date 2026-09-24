import type { Page } from "playwright/test";

import { expect, test } from "../fixtures/animama";
import {
  CreatorMutationGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import { prepareLibraryPreview } from "../helpers/preview-surfaces";

async function readPortableJson(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "View JSON", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  const value = await dialog.getByRole("textbox").inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return value;
}

/** Exercise the actual navigation blocker, without clearing browser storage. */
async function discardToLibrary(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Discard authoring changes?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/a\/library(?:[/?#]|$)/);
}

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
    const guard = await CreatorMutationGuard.attach(page, apiUrl);
    let owned: CreatorOwnedResponse | null = null;
    try {
      await prepareLibraryPreview({
        contentName: "shy-finger-poke",
        page,
        section: "gesture",
      });
      await page
        .getByRole("article", { name: "shy-finger-poke", exact: true })
        .getByRole("link", { name: "Edit", exact: true })
        .click();
      const nameInput = page.getByRole("textbox", {
        name: "gesture name",
        exact: true,
      });
      await expect(nameInput).toHaveValue("shy-finger-poke Custom");
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
        new RegExp(`/a/gestures/${owned.itemId}/edit`),
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
