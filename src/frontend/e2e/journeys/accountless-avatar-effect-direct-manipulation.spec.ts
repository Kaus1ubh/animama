import type { Locator, Page } from "playwright/test";

import { expect, test, type CreatorContentPlan } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  CreatorMutationGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import { selectAnnieFromSidebar } from "../helpers/preview-surfaces";

/**
 * Avatar Effect direct manipulation: create an effect, drag its art on the
 * preview, undo and redo the drag as one step, save, reopen with the dragged
 * placement, then correct and restore one of the preview Avatar's face parts.
 */

const JOURNEY_KEY = "avatar-effect-direct-manipulation";
/** A small non-square PNG, so the fixture does not depend on catalog art. */
const ART_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAJElEQVR4nGP4H7Dg/0BihlEHjDpg1AGjDhh1wKgDRh0w0A4AAPph3Ey+VSaIAAAAAElFTkSuQmCC";

type ScreenHandles = Array<{
  label: string;
  center: { x: number; y: number };
  rotate: { x: number; y: number };
}>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${JOURNEY_KEY}.`);
  return value;
}

function effectNameFromRunId(runId: string): string {
  const match = /^run-(\d{10})$/.exec(runId);
  if (!match?.[1])
    throw new Error(`${JOURNEY_KEY} requires run-MMDDHHmmss; got ${runId}.`);
  return `drag-${match[1]}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The art's handles, in CSS pixels of the preview canvas, once they settle. */
async function readHandles(page: Page): Promise<ScreenHandles> {
  const handles = page.getByTestId("avatar-effect-handles");
  await expect(handles).toHaveAttribute("data-handle-count", "2", {
    timeout: 30_000,
  });
  return JSON.parse(
    (await handles.getAttribute("data-handles")) ?? "[]",
  ) as ScreenHandles;
}

function sidewaysField(page: Page): Locator {
  return page
    .getByRole("group", { name: "Position (cm)", exact: true })
    .getByRole("spinbutton", { name: "Sideways", exact: true });
}

test(`${JOURNEY_KEY} @creator @surface-creator @writes-local`, async ({
  animamaEvidence,
  creatorContent,
  page,
}) => {
  // Two saves, a reopen and an Avatar rebuild after the face-part correction:
  // about 45 s on an idle machine, so the 90 s default leaves no headroom.
  test.setTimeout(180_000);
  const runId = requiredEnvironment("ANIMAMA_E2E_RUN_ID");
  const name = effectNameFromRunId(runId);
  const logicalKey = `local:avatar-effect:${name}`;
  const catalogBefore = await creatorContent.snapshotLocalCatalog();
  const preflight = await creatorContent.preflightContentAbsence({
    logicalKey,
    expectedRelativePath: `vfx/avatar/${name}`,
  });
  await animamaEvidence.attachJson(`${JOURNEY_KEY}-preflight`, preflight);
  const animaId = await selectAnnieFromSidebar(page);
  const loadoutBefore = await creatorContent.snapshotAnimaLoadout(animaId);
  const plan: CreatorContentPlan = await creatorContent.planContent({
    journeyKey: JOURNEY_KEY,
    kind: "avatar_effect",
    entryName: name,
    logicalKey,
  });
  const apiUrl = requiredEnvironment("ANIMAMA_E2E_API_URL");
  const mutationGuard = await CreatorMutationGuard.attach(page, apiUrl);
  let owned: CreatorOwnedResponse | null = null;
  let dragged = 0;

  try {
    await test.step("Open the Avatar Effect creator and choose art", async () => {
      await openCreatorStage({
        creator: "Avatar VFX",
        page,
        selectAnnie: false,
      });
      await page
        .locator('input[type="file"][aria-label="Image"]')
        .setInputFiles({
          name: "drag-art.png",
          mimeType: "image/png",
          buffer: Buffer.from(ART_PNG, "base64"),
        });
      await expect(
        page.getByText("drag-art.png", { exact: true }),
      ).toBeVisible();
      await expect(sidewaysField(page)).toHaveValue("0");
    });

    await test.step("Drag the art across the face; it moves its mirrored copy too", async () => {
      const [primary, mirrored] = await readHandles(page);
      const canvas = page
        .getByTestId("avatar-effect-creator-canvas")
        .locator("canvas")
        .first();
      const box = await canvas.boundingBox();
      if (!primary || !mirrored || !box)
        throw new Error("The art and its mirrored copy have no handles.");
      await page.mouse.move(box.x + primary.center.x, box.y + primary.center.y);
      await page.mouse.down();
      await page.mouse.move(
        box.x + primary.center.x + 24,
        box.y + primary.center.y - 16,
        { steps: 6 },
      );
      await page.mouse.up();
      await expect(sidewaysField(page)).not.toHaveValue("0");
      dragged = Number(await sidewaysField(page).inputValue());
      expect(Math.abs(dragged)).toBeGreaterThan(0.1);
      // The art follows the pointer; its mirrored copy moves the other way
      // sideways and the same way up.
      await expect
        .poll(async () => {
          const [after, copy] = await readHandles(page);
          return {
            primaryRight: after!.center.x > primary.center.x + 10,
            copyLeft: copy!.center.x < mirrored.center.x - 10,
            bothUp:
              after!.center.y < primary.center.y - 5 &&
              copy!.center.y < mirrored.center.y - 5,
          };
        })
        .toEqual({ primaryRight: true, copyLeft: true, bothUp: true });
      await expect(
        page.getByRole("button", { name: "Unsaved", exact: true }),
      ).toBeVisible();
      await animamaEvidence.attachBuffer(
        `${JOURNEY_KEY}-dragged`,
        await page
          .locator('[data-playback-surface="creator-stage"]')
          .screenshot({ animations: "allow" }),
        "image/png",
      );
    });

    await test.step("Undo removes the whole drag in one step; Redo restores it", async () => {
      await page.getByRole("button", { name: /^Undo ·/ }).click();
      await expect(sidewaysField(page)).toHaveValue("0");
      await page.getByRole("button", { name: /^Redo ·/ }).click();
      await expect(sidewaysField(page)).toHaveValue(String(dragged));
    });

    await test.step("Save the dragged effect as new Local content", async () => {
      const nameInput = page.getByRole("textbox", {
        name: "Avatar FX name",
        exact: true,
      });
      await nameInput.fill(name);
      mutationGuard.armSave({
        family: "avatar-effects",
        entryName: name,
        logicalKey,
        recordOwned: (identity) =>
          creatorContent.recordOwnedContent(plan, identity),
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      owned = await mutationGuard.waitForOwned();
      await expect(page).toHaveURL(
        new RegExp(
          `/avatar-effects/${escapeRegExp(encodeURIComponent(owned.itemId))}/edit(?:[?#]|$)`,
        ),
      );
      await expect(
        page.getByRole("button", { name: "Saved", exact: true }),
      ).toBeVisible();
      const verified = await creatorContent.verifyOwnedContent(plan, owned);
      await animamaEvidence.attachJson(`${JOURNEY_KEY}-saved`, {
        owned,
        files: verified.files,
      });
    });

    await test.step("Reopen the saved effect with the dragged placement", async () => {
      await page.reload();
      await expect(
        page.getByRole("textbox", { name: "Avatar FX name", exact: true }),
      ).toHaveValue(name);
      await expect(sidewaysField(page)).toHaveValue(String(dragged));
      const json = await (async () => {
        await page
          .getByRole("button", { name: "View JSON", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Portable Avatar Effect JSON",
          exact: true,
        });
        const text = await dialog.getByRole("textbox").inputValue();
        await page.keyboard.press("Escape");
        return JSON.parse(text) as {
          schema: string;
          document: { attachment: { offset: { x: number } } };
        };
      })();
      expect(json.schema).toBe("animama/avatar-effect-editor/2");
      // The field shows two decimals of the stored metres × 100.
      expect(json.document.attachment.offset.x * 100).toBeCloseTo(dragged, 1);
      await readHandles(page);
    });

    await test.step("Correct a face part on the preview Avatar, then restore detection", async () => {
      mutationGuard.armFacePartCorrections(2);
      await page
        .getByRole("button", { name: "Face parts", exact: true })
        .click();
      const panel = page.getByRole("dialog", {
        name: /^Face parts on /,
      });
      await expect(panel).toBeVisible();
      await panel
        .getByRole("button", { name: "Edit eyelashes", exact: true })
        .click();
      await panel
        .getByRole("list", { name: "Mesh parts for eyelashes", exact: true })
        .getByRole("checkbox")
        .first()
        .click();
      await expect(panel.getByText("Changed, not saved")).toBeVisible();
      await panel
        .getByRole("button", { name: "Save correction", exact: true })
        .click();
      const eyelashes = panel
        .getByRole("listitem")
        .filter({ hasText: "Eyelashes (optional)" });
      await expect(
        eyelashes.getByText("Corrected", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await panel
        .getByRole("button", { name: "Use detected parts", exact: true })
        .click();
      await expect(
        eyelashes.getByText(/^(Missing|Detected|Found by name)/),
      ).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press("Escape");
    });
  } finally {
    let failure: unknown = null;
    // Restore any correction this journey left behind.
    try {
      for (const itemId of mutationGuard.correctedAvatarItems) {
        const url = `${apiUrl.replace(/\/$/, "")}/v1/avatar-content/${encodeURIComponent(itemId)}/face-parts`;
        const state = (await (await page.request.get(url)).json()) as {
          revision: string;
          face_parts: unknown;
        };
        if (state.face_parts !== null) {
          const reset = await page.request.put(url, {
            data: { expected_revision: state.revision, face_parts: null },
          });
          expect(reset.ok()).toBe(true);
        }
      }
    } catch (error) {
      failure = error;
    }
    try {
      const identity = owned as CreatorOwnedResponse | null;
      if (identity) mutationGuard.armDelete(identity);
      const cleanup = await creatorContent.cleanupOwnedContent();
      if (identity) {
        mutationGuard.recordExternalDelete(identity);
        expect(cleanup).toMatchObject({ attempted: 1, deleted: 1, failed: 0 });
        await animamaEvidence.attachJson(
          `${JOURNEY_KEY}-deletion-proof`,
          await creatorContent.assertDeletedContent(plan, identity),
        );
      }
      await creatorContent.assertLocalCatalogUnchanged(
        catalogBefore,
        animamaEvidence,
        JOURNEY_KEY,
      );
      await creatorContent.assertAnimaLoadoutUnchanged(
        loadoutBefore,
        animamaEvidence,
      );
    } catch (error) {
      failure ??= error;
    }
    try {
      await mutationGuard.assertPolicy(animamaEvidence);
    } catch (error) {
      failure ??= error;
    }
    await mutationGuard.dispose();
    if (failure) throw failure;
  }
});
