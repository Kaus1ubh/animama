import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type CreatorContentPlan } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  CreatorMutationGuard,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import { selectAnnieFromSidebar } from "../helpers/preview-surfaces";
import type { Page } from "playwright/test";

/**
 * A generated animaPoseClip/2.0 Gesture opens in the creator as labelled beats
 * with their detail, survives a retime and a pose edit, saves as 2.0 and
 * reopens with the detail intact.
 */
const JOURNEY_KEY = "creator-generated-gesture-round-trip";
const EXAMPLE = fileURLToPath(
  new URL(
    "../../../../content/included/gestures/hearty-laugh/hearty-laugh.json",
    import.meta.url,
  ),
);

type Key = { beat: string; dt?: number; v?: number | "base" };
type Clip = {
  schema: string;
  beats: Array<{ id: string; label: string; time: number }>;
  joints: Record<string, Record<string, Key[]>>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${JOURNEY_KEY}.`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readClipJson(page: Page): Promise<Clip> {
  // Import notices sit over the header's View JSON control until they close;
  // a pointer resting on one keeps it open.
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("region", { name: /Notifications/ }).getByText(/imported/),
  ).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("button", { name: "View JSON", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Creator JSON",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const clip = JSON.parse(
    await dialog
      .getByLabel("Creator JSON preview", { exact: true })
      .inputValue(),
  ) as Clip;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  return clip;
}

/** Keys that a beat owns away from its time: its generated detail. */
function detailOf(clip: Clip, beat: string) {
  return Object.entries(clip.joints).flatMap(([joint, components]) =>
    Object.entries(components).flatMap(([component, keys]) =>
      keys
        .filter((key) => key.beat === beat && key.dt)
        .map((key) => `${joint}.${component}@${key.dt}`),
    ),
  );
}

test.describe("Generated Gesture creator round trip", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test(`${JOURNEY_KEY} @creator @surface-creator @channel-gesture @writes-local`, async ({
    animamaEvidence,
    creatorContent,
    page,
  }) => {
    const runId = requiredEnvironment("ANIMAMA_E2E_RUN_ID");
    const name = `laugh-${runId.replace(/^run-/, "")}`;
    const semanticKey = `laugh_${runId.replace(/^run-/, "")}`;
    const logicalKey = `local:gesture:${name}`;
    const catalogBefore = await creatorContent.snapshotLocalCatalog();
    const animaId = await selectAnnieFromSidebar(page);
    const loadoutBefore = await creatorContent.snapshotAnimaLoadout(animaId);
    const plan: CreatorContentPlan = await creatorContent.planContent({
      journeyKey: JOURNEY_KEY,
      kind: "gesture",
      entryName: name,
      logicalKey,
    });
    const mutationGuard = await CreatorMutationGuard.attach(
      page,
      requiredEnvironment("ANIMAMA_E2E_API_URL"),
    );
    let owned: CreatorOwnedResponse | null = null;
    let failure: unknown = null;
    const original = JSON.parse(readFileSync(EXAMPLE, "utf8")) as Clip;

    try {
      await test.step("Import the generated 2.0 Gesture as a project", async () => {
        await openCreatorStage({
          creator: "Gesture",
          page,
          selectAnnie: false,
        });
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();
        const dialog = page.getByRole("dialog", {
          name: "Import",
          exact: true,
        });
        await dialog
          .locator('input[type="file"][accept=".json,application/json"]')
          .setInputFiles({
            name: `${name}.project.json`,
            mimeType: "application/json",
            buffer: Buffer.from(
              JSON.stringify({
                schema: "animamaActionProject/1.0",
                intent: "gesture",
                name,
                aiDescription: "A big, warm laugh at something very funny.",
                semanticKey,
                sequence: original,
                dependencies: [],
              }),
            ),
          });
        await expect(
          dialog.getByText(
            "Typed project imported with exact dependency pins.",
          ),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        // Beats appear by label; detail-carrying beats say so.
        await expect(
          page.getByRole("button", {
            name: "Burst keyframe at 0.60s with generated detail",
          }),
        ).toBeVisible();
      });

      await test.step("Retime a beat with its detail", async () => {
        await page
          .getByRole("button", { name: /^Laughing keyframe at 1\.20s/ })
          .click();
        const time = page.getByLabel("Selected keyframe time", { exact: true });
        await time.fill("1.3");
        await time.press("Enter");
        await expect(
          page.getByRole("button", { name: /^Laughing keyframe at 1\.30s/ }),
        ).toBeVisible();
      });

      await test.step("Edit a beat's pose in the Pose tab", async () => {
        await page
          .getByRole("button", { name: /^Recover keyframe at 2\.40s/ })
          .click();
        await page.getByRole("tab", { name: "Pose", exact: true }).click();
        const x = page.getByLabel("X rotation degrees", { exact: true });
        await expect(x).toBeVisible();
        const value = Number(await x.inputValue());
        await x.fill(String(value + 12));
        await x.press("Enter");
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
      });

      const edited = await test.step("Check the edited clip JSON", async () => {
        const clip = await readClipJson(page);
        expect(clip.schema).toBe("animaPoseClip/2.0");
        expect(clip.beats.find((beat) => beat.id === "laughing")?.time).toBe(
          1.3,
        );
        // Detail stays with its beat: same keys, same owners.
        for (const beat of ["burst", "laughing"])
          expect(detailOf(clip, beat).length).toBe(
            detailOf(original, beat).length,
          );
        expect(clip.joints.leftUpperArm).not.toEqual(
          original.joints.leftUpperArm,
        );
        await animamaEvidence.attachJson(`${JOURNEY_KEY}-edited`, clip);
        return clip;
      });

      await test.step("Save, reopen and compare", async () => {
        mutationGuard.armSave({
          family: "gestures",
          entryName: name,
          logicalKey,
          recordOwned: (identity) =>
            creatorContent.recordOwnedContent(plan, identity),
        });
        await page
          .getByRole("button", { name: "Save content", exact: true })
          .click();
        owned = await mutationGuard.waitForOwned();
        await expect(page).toHaveURL(
          new RegExp(
            `/gestures/${escapeRegExp(encodeURIComponent(owned.itemId))}/edit(?:[?#]|$)`,
          ),
        );
        const verified = await creatorContent.verifyOwnedContent(plan, owned);
        const files = verified.files as unknown as {
          parsedJson: Record<string, unknown>;
          relativeLocator: string;
        };
        const saved = Object.entries(files.parsedJson).find(
          ([path]) => path.endsWith(".json") && !path.endsWith(".meta.json"),
        )?.[1];
        expect(saved).toEqual({ ...edited, id: (saved as { id: string }).id });
        await page.reload();
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        await expect(
          page.getByRole("button", {
            name: "Burst keyframe at 0.60s with generated detail",
          }),
        ).toBeVisible();
        expect(await readClipJson(page)).toEqual(saved);
      });

      await test.step("Click a saved Gesture's Avatar without reloading it", async () => {
        // A saved item mounts its preview runtime; creator re-renders (bone
        // markers, the gizmo) must not rebuild it and reload the Avatar.
        await page
          .getByRole("button", { name: /^Recover keyframe at 2\.40s/ })
          .click();
        await page.getByRole("tab", { name: "Pose", exact: true }).click();
        await expect(
          page.getByLabel("X rotation degrees", { exact: true }),
        ).toBeVisible();
        await page.evaluate(() => {
          const flags = window as unknown as { avatarReloads: number };
          flags.avatarReloads = 0;
          new MutationObserver(() => {
            if (document.body.innerText.includes("Loading Avatar…"))
              flags.avatarReloads += 1;
          }).observe(document.body, { childList: true, subtree: true });
        });
        const box = await page
          .locator('[data-testid="action-editor-canvas"]:visible')
          .boundingBox();
        expect(box).not.toBeNull();
        for (const [fx, fy] of [
          [0.5, 0.3],
          [0.45, 0.4],
          [0.55, 0.7],
          [0.5, 0.5],
        ])
          await page.mouse.click(
            box!.x + box!.width * fx,
            box!.y + box!.height * fy,
          );
        await page.waitForTimeout(500);
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { avatarReloads: number }).avatarReloads,
          ),
        ).toBe(0);
      });
    } catch (error) {
      // Report the journey's own failure ahead of any cleanup failure.
      failure = error;
    } finally {
      try {
        if (owned) mutationGuard.armDelete(owned);
        const cleanup = await creatorContent.cleanupOwnedContent();
        if (owned) {
          mutationGuard.recordExternalDelete(owned);
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
          JOURNEY_KEY,
        );
        await creatorContent.assertAnimaLoadoutUnchanged(
          loadoutBefore,
          animamaEvidence,
        );
        await mutationGuard.assertPolicy(animamaEvidence);
      } catch (error) {
        failure ??= error;
      }
      await mutationGuard.dispose();
    }
    if (failure) throw failure;
  });

  for (const kind of ["gesture", "reaction"] as const) {
    test(`creator-1-0-${kind}-import-is-rejected @creator @surface-creator @channel-${kind}`, async ({
      animamaEvidence,
      creatorContent,
      page,
    }) => {
      const runId = requiredEnvironment("ANIMAMA_E2E_RUN_ID");
      const name = `${kind}-v1-${runId.replace(/^run-/, "")}`;
      const catalogBefore = await creatorContent.snapshotLocalCatalog();
      const mutationGuard = await CreatorMutationGuard.attach(
        page,
        requiredEnvironment("ANIMAMA_E2E_API_URL"),
      );
      let failure: unknown = null;
      try {
        await test.step("Reject a retired 1.0 clip on import", async () => {
          await openCreatorStage({
            creator: kind === "gesture" ? "Gesture" : "Reaction",
            page,
          });
          if (kind === "gesture")
            await page.getByRole("tab", { name: "Clip", exact: true }).click();
          await page
            .getByRole("button", { name: "Import", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Import",
            exact: true,
          });
          await dialog
            .locator('input[type="file"][accept=".json,application/json"]')
            .setInputFiles({
              name: `${name}.project.json`,
              mimeType: "application/json",
              buffer: Buffer.from(
                JSON.stringify({
                  schema: "animamaActionProject/1.0",
                  intent: kind,
                  name,
                  aiDescription: "A retired 1.0 clip.",
                  semanticKey: name.replaceAll("-", "_"),
                  sequence: {
                    schema: "animaPoseClip/1.0",
                    id: name,
                    name,
                    duration: 1,
                    poses: { happy: { expressions: { happy: 1 } } },
                    poseKeyframes: [{ time: 0, pose: "happy" }],
                  },
                  dependencies: [],
                }),
              ),
            });
          await expect(
            dialog.getByText(/retired animaPoseClip\/1\.0 format/),
          ).toBeVisible();
          await expect(
            dialog.getByText(
              "Typed project imported with exact dependency pins.",
            ),
          ).toHaveCount(0);
        });
      } catch (error) {
        failure = error;
      } finally {
        try {
          await creatorContent.assertLocalCatalogUnchanged(
            catalogBefore,
            animamaEvidence,
            `creator-1-0-${kind}-import-is-rejected`,
          );
          await mutationGuard.assertPolicy(animamaEvidence);
        } catch (error) {
          failure ??= error;
        }
        await mutationGuard.dispose();
      }
      if (failure) throw failure;
    });
  }
});
