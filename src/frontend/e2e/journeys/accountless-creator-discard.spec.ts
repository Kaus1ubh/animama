import type { Page } from "playwright/test";

import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  CreatorMutationGuard,
  ReadOnlyJourneyGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import { prepareLibraryPreview } from "../helpers/preview-surfaces";

const cases = [
  {
    creator: "Avatar VFX",
    section: "avatar",
    contentName: "Eye =",
    nameLabel: "Avatar FX name",
    jsonTitle: "Portable Avatar Effect JSON",
  },
  {
    creator: "Scene VFX",
    section: "scene",
    contentName: "Kawaii Sparkles",
    nameLabel: "Scene FX name",
    jsonTitle: "Portable Scene Effect JSON",
  },
  {
    creator: "Gesture",
    section: "gesture",
    contentName: "shy-finger-poke",
    nameLabel: "gesture name",
    jsonTitle: "Creator JSON",
  },
] as const;

async function readPortableJson(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "View JSON", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  const value = await dialog.getByRole("textbox").inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return value;
}

type StoredDraftExpectation = {
  /** IndexedDB database the creator writes; localStorage is always checked. */
  database: string | null;
  name: string;
  setting: { path: string[]; value: number } | null;
};

/**
 * Wait until browser recovery holds this exact draft, rather than guessing the
 * creator's autosave debounce. Never opens a database the page has not
 * created, so the creator's own schema upgrade still runs.
 */
async function waitForStoredDraft(
  page: Page,
  expected: StoredDraftExpectation,
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async ({ database, name, setting }) => {
          const matches = (record: unknown): boolean => {
            if (!record || typeof record !== "object") return false;
            const document = (record as { document?: unknown }).document;
            if (!document || typeof document !== "object") return false;
            if ((document as { name?: unknown }).name !== name) return false;
            if (!setting) return true;
            let value: unknown = document;
            for (const key of setting.path)
              value = (value as Record<string, unknown> | null)?.[key];
            return value === setting.value;
          };
          for (let index = 0; index < localStorage.length; index += 1) {
            const raw = localStorage.getItem(localStorage.key(index) ?? "");
            try {
              if (raw && matches(JSON.parse(raw))) return true;
            } catch {
              // Unrelated non-JSON settings.
            }
          }
          if (!database) return false;
          const known = await indexedDB.databases();
          if (!known.some((entry) => entry.name === database)) return false;
          return new Promise<boolean>((resolve) => {
            const opening = indexedDB.open(database);
            opening.onerror = () => resolve(false);
            opening.onsuccess = () => {
              const db = opening.result;
              const stores = Array.from(db.objectStoreNames);
              if (stores.length === 0) {
                db.close();
                resolve(false);
                return;
              }
              const request = db
                .transaction(stores[0]!, "readonly")
                .objectStore(stores[0]!)
                .getAll();
              request.onsuccess = () => {
                db.close();
                resolve(request.result.some(matches));
              };
              request.onerror = () => {
                db.close();
                resolve(false);
              };
            };
          });
        }, expected),
      { message: "browser recovery stores the edited draft" },
    )
    .toBe(true);
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
  await expect(page).toHaveURL(/\/library(?:[/?#]|$)/);
}

for (const item of cases) {
  for (const origin of ["existing", "new", "immediate"] as const) {
    if (item.section === "gesture" && origin !== "existing") continue;
    test(`accountless ${item.section} creator discard ${origin} draft before Library Edit`, async ({
      page,
      creatorContent,
      animamaEvidence,
    }) => {
      const expectedName =
        item.section === "gesture"
          ? `${item.contentName} Custom`
          : item.contentName;
      const catalogBefore = await creatorContent.snapshotLocalCatalog();
      const guard = new ReadOnlyJourneyGuard(page);
      const openExisting = async () => {
        await prepareLibraryPreview({
          contentName: item.contentName,
          page,
          section: item.section,
        });
        await page
          .getByRole("article", { name: item.contentName, exact: true })
          .getByRole("link", { name: "Edit", exact: true })
          .click();
        await expect(
          page.getByRole("textbox", { name: item.nameLabel, exact: true }),
        ).toBeVisible();
      };
      try {
        let originalJson: string | null = null;
        let newDraftName: string | null = null;
        if (origin !== "new") {
          await openExisting();
          await expect(
            page.getByRole("textbox", { name: item.nameLabel, exact: true }),
          ).toHaveValue(expectedName);
          originalJson = await readPortableJson(page, item.jsonTitle);
        } else {
          await openCreatorStage({ creator: item.creator, page });
          newDraftName = await page
            .getByRole("textbox", { name: item.nameLabel, exact: true })
            .inputValue();
        }
        const discardedName = `Discarded ${item.section} ${origin}`;
        await page
          .getByRole("textbox", { name: item.nameLabel, exact: true })
          .fill(discardedName);
        let changedJson: string | null = null;
        let changedSetting: StoredDraftExpectation["setting"] = null;
        if (item.section !== "gesture") {
          const setting =
            item.section === "avatar"
              ? page
                  .getByText("Position Offset", { exact: true })
                  .locator("..")
                  .getByRole("spinbutton", { name: "X", exact: true })
              : page.getByRole("spinbutton", {
                  name: "Duration (s)",
                  exact: true,
                });
          const nextValue =
            Number(await setting.inputValue()) +
            (item.section === "avatar" ? 0.25 : 1);
          await setting.fill(String(nextValue));
          await setting.blur();
          changedSetting =
            item.section === "avatar"
              ? { path: ["transform", "offset", "x"], value: nextValue }
              : { path: ["durationMs"], value: nextValue * 1000 };
          changedJson = await readPortableJson(page, item.jsonTitle);
          const changedDocument = JSON.parse(changedJson).document;
          expect(
            item.section === "avatar"
              ? changedDocument.transform.offset.x
              : changedDocument.durationMs / 1000,
          ).toBe(nextValue);
          if (originalJson !== null) expect(changedJson).not.toBe(originalJson);
        }
        await expect(
          page.getByRole(item.section === "gesture" ? "status" : "button", {
            name: "Unsaved",
            exact: true,
          }),
        ).toBeVisible();
        // Let this real draft reach browser recovery before discarding, so the
        // journey detects recovery resurrecting it.
        if (origin !== "immediate")
          await waitForStoredDraft(page, {
            database:
              item.section === "avatar"
                ? "animama-avatar-effect-creator-recovery"
                : item.section === "scene"
                  ? "animama-scene-effect-creator-recovery"
                  : null,
            name: discardedName,
            setting: changedSetting,
          });
        if (item.section === "avatar" && origin === "existing") {
          page.once("dialog", (dialog) => dialog.accept());
          await page.reload();
          await expect(
            page.getByRole("textbox", { name: item.nameLabel, exact: true }),
          ).toHaveValue(discardedName);
          expect(await readPortableJson(page, item.jsonTitle)).toBe(
            changedJson,
          );
        }
        await discardToLibrary(page);
        await openExisting();
        await expect(
          page.getByRole("textbox", { name: item.nameLabel, exact: true }),
        ).toHaveValue(expectedName);
        const reopenedJson = await readPortableJson(page, item.jsonTitle);
        expect(reopenedJson).not.toContain(discardedName);
        if (originalJson !== null) expect(reopenedJson).toBe(originalJson);
        if (origin === "new") {
          // Included content opens as an unsaved copy. Leave that copy through
          // its blocker before checking that the earlier New draft is gone.
          await discardToLibrary(page);
          await openCreatorStage({ creator: item.creator, page });
          await expect(
            page.getByRole("textbox", { name: item.nameLabel, exact: true }),
          ).toHaveValue(newDraftName!);
        }
        await animamaEvidence.attachJson(
          `${item.section}-${origin}-discard-reopen`,
          { originalJson, changedJson, reopenedJson },
        );
      } finally {
        try {
          await guard.assertNoMutations(animamaEvidence);
          await creatorContent.assertLocalCatalogUnchanged(
            catalogBefore,
            animamaEvidence,
            `${item.section}-${origin}-discard`,
          );
        } finally {
          await guard.dispose();
        }
      }
    });
  }
}

test("accountless Local scene creator discard preserves its saved revision", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  const runId = process.env.ANIMAMA_E2E_RUN_ID;
  const apiUrl = process.env.ANIMAMA_E2E_API_URL;
  if (!runId || !apiUrl)
    throw new Error("The isolated E2E runner environment is required.");
  const name = `discard-scene-${runId}`;
  const logicalKey = `local:scene-effect:${name}`;
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  await creatorContent.preflightContentAbsence({
    logicalKey,
    expectedRelativePath: `vfx/scene/${name}`,
  });
  const plan = await creatorContent.planContent({
    journeyKey: "local-scene-discard",
    kind: "scene_effect",
    entryName: name,
    logicalKey,
  });
  const guard = await CreatorMutationGuard.attach(page, apiUrl);
  let owned: CreatorOwnedResponse | null = null;
  try {
    await openCreatorStage({ creator: "Scene VFX", page });
    const nameInput = page.getByRole("textbox", {
      name: "Scene FX name",
      exact: true,
    });
    await nameInput.fill(name);
    guard.armSave({
      family: "scene-effects",
      entryName: name,
      logicalKey,
      recordOwned: (identity) =>
        creatorContent.recordOwnedContent(plan, identity),
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    owned = await guard.waitForOwned();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    const savedJson = await readPortableJson(
      page,
      "Portable Scene Effect JSON",
    );
    await nameInput.fill(`${name}-discarded`);
    await page.waitForTimeout(700);
    await discardToLibrary(page);
    await prepareLibraryPreview({
      contentName: name,
      origin: "Mine",
      page,
      section: "scene",
    });
    await page
      .getByRole("article", { name, exact: true })
      .getByRole("link", { name: "Edit", exact: true })
      .click();
    await expect(nameInput).toHaveValue(name);
    expect(await readPortableJson(page, "Portable Scene Effect JSON")).toBe(
      savedJson,
    );
    // The item/revision pair proves unsaved changes never reached canonical content.
    await creatorContent.verifyOwnedContent(plan, owned);
    await animamaEvidence.attachJson(
      "local-scene-discard-saved-revision",
      owned,
    );
  } finally {
    try {
      if (owned) guard.armDelete(owned);
      const cleanup = await creatorContent.cleanupOwnedContent();
      if (owned) {
        guard.recordExternalDelete(owned);
        expect(cleanup).toMatchObject({ attempted: 1, deleted: 1, failed: 0 });
        await creatorContent.assertDeletedContent(plan, owned);
      }
      await creatorContent.assertLocalCatalogUnchanged(
        catalogBefore,
        animamaEvidence,
        "local-scene-discard-cleanup",
      );
      await guard.assertPolicy(animamaEvidence);
    } finally {
      await guard.dispose();
    }
  }
});
