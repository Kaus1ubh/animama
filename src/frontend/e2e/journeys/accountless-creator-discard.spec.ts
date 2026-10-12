import { expect, test } from "../fixtures/animama";
import {
  discardToLibrary,
  openCreatorStage,
  readPortableJson,
  waitForStoredDraft,
  type StoredDraftExpectation,
} from "../helpers/creator-surfaces";
import {
  CreatorMutationGuard,
  ReadOnlyJourneyGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import {
  prepareLibraryPreview,
  selectAnnieFromSidebar,
} from "../helpers/preview-surfaces";

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
    // Included backgrounds are held (no duration); the focus preset is timed.
    contentName: "Focus Lines Dark",
    nameLabel: "Scene FX name",
    jsonTitle: "Portable Scene Effect JSON",
  },
  {
    creator: "Gesture",
    section: "gesture",
    contentName: "Have an Idea",
    nameLabel: "gesture name",
    jsonTitle: "Creator JSON",
  },
] as const;

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
          // Avatar Effect positions are shown in centimetres and stored in metres.
          const setting =
            item.section === "avatar"
              ? page
                  .getByRole("group", { name: "Position (cm)", exact: true })
                  .getByRole("spinbutton", { name: "Right", exact: true })
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
              ? { path: ["attachment", "offset", "x"], value: nextValue / 100 }
              : { path: ["durationMs"], value: nextValue * 1000 };
          changedJson = await readPortableJson(page, item.jsonTitle);
          const changedDocument = JSON.parse(changedJson).document;
          expect(
            item.section === "avatar"
              ? changedDocument.attachment.offset.x * 100
              : changedDocument.durationMs / 1000,
          ).toBeCloseTo(nextValue, 6);
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
        if (item.section !== "gesture" && origin === "existing") {
          page.once("dialog", (dialog) => dialog.accept());
          await page.reload();
          await expect(
            page.getByRole("textbox", { name: item.nameLabel, exact: true }),
          ).toHaveValue(discardedName);
          expect(await readPortableJson(page, item.jsonTitle)).toBe(
            changedJson,
          );
          // The restored draft is announced, as in the Particle creator, and
          // Discard recovery returns to the item's saved version.
          const recoveryNotice = page.getByRole("status").filter({
            hasText: `Recovered unsaved ${
              item.section === "avatar" ? "Avatar Effect" : "Scene Effect"
            } changes.`,
          });
          await expect(recoveryNotice).toBeVisible();
          await recoveryNotice
            .getByRole("button", { name: "Discard recovery", exact: true })
            .click();
          await expect(recoveryNotice).toBeHidden();
          await expect(
            page.getByRole("textbox", { name: item.nameLabel, exact: true }),
          ).toHaveValue(expectedName);
          expect(await readPortableJson(page, item.jsonTitle)).toBe(
            originalJson,
          );
          // Edit again so the blocker below still has a draft to discard.
          await page
            .getByRole("textbox", { name: item.nameLabel, exact: true })
            .fill(discardedName);
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
  // Visiting Annie may persist her as the last active Anima. Do that before
  // the guard so it limits only this journey's creator writes.
  await selectAnnieFromSidebar(page);
  const guard = await CreatorMutationGuard.attach(page, apiUrl);
  let owned: CreatorOwnedResponse | null = null;
  try {
    await openCreatorStage({
      creator: "Scene VFX",
      page,
      selectAnnie: false,
    });
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
