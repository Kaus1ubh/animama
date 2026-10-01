import { expect, test, type CreatorContentPlan } from "../fixtures/animama";
import {
  authorHappyToAngryReaction,
  reactionNameFromRunId,
  setReactionPlayhead,
  validateReactionClipDocument,
  validateReactionMetadata,
  type ValidatedReactionClip,
} from "../helpers/creator-reaction";
import { openCreatorStage } from "../helpers/creator-surfaces";
import { attachPlaybackCheckpoint } from "../helpers/checkpoints";
import { proveExpressionTransition } from "../helpers/playback-assertions";
import {
  OBSERVATION_SAMPLE_INTERVAL_MS,
  readPlaybackObservation,
  type PlaybackObservation,
} from "../helpers/playback-observation";
import {
  CreatorMutationGuard,
  PreviewNetworkRecorder,
  type CreatorOwnedResponse,
} from "../helpers/preview-network";
import {
  prepareLibraryPreview,
  selectAnnieFromSidebar,
} from "../helpers/preview-surfaces";

const JOURNEY_KEY = "creator-reaction-expression-transition";

type VerifiedLocalFiles = {
  relativeLocator: string;
  directoryLocator: string;
  fileCount: number;
  manifestSha256: string;
  manifest: Array<{
    relativePath: string;
    role: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
  }>;
  parsedJson: Record<string, unknown>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${JOURNEY_KEY}.`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForStoppedHappyState(args: {
  expectedRuntimeId: string;
  surface: Parameters<typeof readPlaybackObservation>[0];
  timeoutMs?: number;
}): Promise<PlaybackObservation> {
  const deadline = Date.now() + (args.timeoutMs ?? 10_000);
  let last: PlaybackObservation | null = null;
  while (Date.now() <= deadline) {
    last = await readPlaybackObservation(args.surface);
    if (
      last.target.kind === "anima_pose_clip" &&
      last.target.runtimeId === args.expectedRuntimeId &&
      last.target.status === "stopped" &&
      (last.expressions.happy ?? 0) >= 0.9 &&
      (last.expressions.angry ?? 0) <= 0.1
    ) {
      return last;
    }
    await args.surface.page().waitForTimeout(OBSERVATION_SAMPLE_INTERVAL_MS);
  }
  throw new Error(
    `Creator did not expose stopped Happy time zero for ${args.expectedRuntimeId}; last observation was ${JSON.stringify(last)}.`,
  );
}

async function stopAndCloseLibraryPreview(
  surface: Parameters<typeof readPlaybackObservation>[0] | null,
): Promise<void> {
  if (!surface || !(await surface.isVisible().catch(() => false))) return;
  const stop = surface.getByRole("button", { name: "Stop", exact: true });
  if ((await stop.isVisible()) && (await stop.isEnabled())) await stop.click();
  const minimize = surface.getByRole("button", {
    name: "Minimize preview",
    exact: true,
  });
  if (await minimize.isVisible()) await minimize.click();
  const destroy = surface.getByRole("button", {
    name: "Destroy preview",
    exact: true,
  });
  if (await destroy.isVisible()) await destroy.click();
}

test.describe("Reaction creator round trip", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test(`${JOURNEY_KEY} @creator @surface-creator @surface-library @channel-reaction @writes-local`, async ({
    animamaEvidence,
    creatorContent,
    page,
  }) => {
    const runId = requiredEnvironment("ANIMAMA_E2E_RUN_ID");
    const name = reactionNameFromRunId(runId);
    const logicalKey = `local:reaction:${name}`;
    const relativeLocator = `reactions/${name}`;
    const expectedTarget = {
      kind: "anima_pose_clip" as const,
      runtimeId: name,
    };
    const catalogBefore =
      await test.step("Snapshot pre-existing Local content", () =>
        creatorContent.snapshotLocalCatalog());
    const preflight =
      await test.step("Prove the generated catalog identity and host path are unused", () =>
        creatorContent.preflightContentAbsence({
          logicalKey,
          expectedRelativePath: relativeLocator,
        }));
    await animamaEvidence.attachJson(`${JOURNEY_KEY}-preflight`, preflight);

    const animaId =
      await test.step("Select the unique Annie sidebar Anima", () =>
        selectAnnieFromSidebar(page));
    const loadoutBefore =
      await test.step("Snapshot Annie's persisted loadout", () =>
        creatorContent.snapshotAnimaLoadout(animaId));
    const plan: CreatorContentPlan = await creatorContent.planContent({
      journeyKey: JOURNEY_KEY,
      kind: "reaction",
      entryName: name,
      logicalKey,
    });

    const mutationGuard = await CreatorMutationGuard.attach(
      page,
      requiredEnvironment("ANIMAMA_E2E_API_URL"),
    );
    const previewNetwork = new PreviewNetworkRecorder(page);
    let owned: CreatorOwnedResponse | null = null;
    let librarySurface: Parameters<typeof readPlaybackObservation>[0] | null =
      null;
    let creatorClip: ValidatedReactionClip | null = null;

    try {
      const stage =
        await test.step("Open the Reaction creator through visible links", () =>
          openCreatorStage({ creator: "Reaction", page, selectAnnie: false }));
      await test.step("Name the generated Reaction", async () => {
        const nameInput = page.getByLabel("reaction name", { exact: true });
        await nameInput.fill(name);
        await expect(nameInput).toHaveValue(name);
        await expect
          .poll(
            async () =>
              (await readPlaybackObservation(stage.surface)).target.runtimeId,
          )
          .toBe(name);
      });
      await test.step("Author Happy and Angry expression landmarks through the timeline UI", () =>
        authorHappyToAngryReaction(page));

      const stoppedAtZero =
        await test.step("Capture stopped Happy at time zero", async () => {
          await setReactionPlayhead(page, 0);
          const observation = await waitForStoppedHappyState({
            expectedRuntimeId: name,
            surface: stage.surface,
          });
          await animamaEvidence.attachJson(
            `${JOURNEY_KEY}-creator-time-zero`,
            observation,
          );
          return observation;
        });
      const creatorPlayback = proveExpressionTransition({
        channel: "poseClip",
        evidence: animamaEvidence,
        evidenceName: `${JOURNEY_KEY}-creator`,
        expectedTarget,
        fromExpression: "happy",
        initialSamples: [stoppedAtZero],
        surface: stage.surface,
        toExpression: "angry",
        transitionTimeSec: 0.3,
      });
      const restart = page.getByRole("button", {
        name: "Restart clip preview",
        exact: true,
      });
      await expect(restart).toBeEnabled();
      const [, creatorSamples] =
        await test.step("Pre-arm and prove creator Happy-to-Angry playback", () =>
          Promise.all([restart.click(), creatorPlayback] as const));
      await test.step("Attach the creator playback checkpoint", () =>
        attachPlaybackCheckpoint({
          evidence: animamaEvidence,
          locator: stage.surface,
          name: `${JOURNEY_KEY}-creator`,
          samples: creatorSamples,
        }));

      creatorClip =
        await test.step("Validate and attach the read-only Clip JSON", async () => {
          await page
            .getByRole("button", { name: "View JSON", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "Creator JSON",
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByLabel("JSON format", { exact: true }),
          ).toContainText("Clip JSON");
          const source = await dialog
            .getByLabel("Creator JSON preview", { exact: true })
            .inputValue();
          let parsed: unknown;
          try {
            parsed = JSON.parse(source);
          } catch (cause) {
            throw new Error("Creator JSON preview was not valid JSON.", {
              cause,
            });
          }
          const validated = validateReactionClipDocument(parsed, name);
          await animamaEvidence.attachJson(
            `${JOURNEY_KEY}-creator-json`,
            validated,
          );
          await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
          return validated;
        });

      await test.step("Arm and perform the one typed Local Save", async () => {
        mutationGuard.armSave({
          family: "reactions",
          entryName: name,
          logicalKey,
          recordOwned: (identity) =>
            creatorContent.recordOwnedContent(plan, identity),
        });
        const save = page.getByRole("button", {
          name: "Save content",
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        owned = await mutationGuard.waitForOwned();
        await animamaEvidence.attachJson(`${JOURNEY_KEY}-save-response`, owned);
        await expect(
          page.getByText("Reaction saved.", { exact: true }),
        ).toBeVisible();
        await expect(page).toHaveURL(
          new RegExp(
            `/reactions/${escapeRegExp(encodeURIComponent(owned.itemId))}/edit(?:[?#]|$)`,
          ),
        );
        await expect(
          page.getByRole("status", { name: "Saved", exact: true }),
        ).toBeVisible();
      });

      await test.step("Verify the neutral catalog item and exact readable Local files", async () => {
        if (!owned || !creatorClip) {
          throw new Error("Save ownership or Creator JSON was not captured.");
        }
        const verified = await creatorContent.verifyOwnedContent(plan, owned);
        const item = verified.item;
        const files = verified.files as unknown as VerifiedLocalFiles;
        expect(owned).toMatchObject({
          itemId: item.item_id,
          revisionSha256: item.revision_sha256,
          source: item.source,
          kind: item.kind,
          logicalKey: item.logical_key,
          name: item.name,
          editable: item.editable,
        });
        expect(item).toMatchObject({
          item_id: owned.itemId,
          revision_sha256: owned.revisionSha256,
          source: "local",
          origin: "local",
          scope: "owner",
          kind: "reaction",
          logical_key: logicalKey,
          display_name: name,
          name,
          relative_locator: relativeLocator,
          status: "valid",
          editable: true,
        });
        expect(files.relativeLocator).toBe(relativeLocator);
        expect(files.directoryLocator).toBe(relativeLocator);
        expect(files.fileCount).toBe(2);
        expect(files.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
        const expectedPaths = [
          `${relativeLocator}/${name}.json`,
          `${relativeLocator}/${name}.meta.json`,
        ];
        expect(files.manifest.map((file) => file.relativePath).sort()).toEqual(
          expectedPaths.sort(),
        );
        for (const file of files.manifest) {
          expect(file.mediaType).toBe("application/json");
          expect(file.sizeBytes).toBeGreaterThan(0);
          expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        expect(
          files.manifest.find(
            (file) => file.relativePath === `${relativeLocator}/${name}.json`,
          )?.role,
        ).toBe("sequence");
        expect(
          files.manifest.find(
            (file) =>
              file.relativePath === `${relativeLocator}/${name}.meta.json`,
          )?.role,
        ).toBe("descriptor");

        const savedClip = files.parsedJson[`${relativeLocator}/${name}.json`];
        const metadata =
          files.parsedJson[`${relativeLocator}/${name}.meta.json`];
        expect(validateReactionClipDocument(savedClip, name)).toEqual(
          creatorClip,
        );
        validateReactionMetadata(metadata, { logicalKey, name });
        await animamaEvidence.attachJson(`${JOURNEY_KEY}-catalog-item`, item);
        await animamaEvidence.attachJson(`${JOURNEY_KEY}-local-files`, files);
      });

      const prepared =
        await test.step("Navigate from the saved editor to the exact Mine Reaction card", () =>
          prepareLibraryPreview({
            contentName: name,
            origin: "Mine",
            page,
            section: "reaction",
            selectAnnie: false,
          }));
      // Retain the surface even if opening or playback proof fails so finally
      // can stop it before deleting the exact saved content.
      librarySurface = prepared.surface;
      const libraryPlayback = proveExpressionTransition({
        channel: "reactionClip",
        evidence: animamaEvidence,
        evidenceName: `${JOURNEY_KEY}-library`,
        expectedTarget,
        fromExpression: "happy",
        surface: prepared.surface,
        surfaceKind: "library-dock",
        toExpression: "angry",
        transitionTimeSec: 0.3,
      });
      const [surface, librarySamples] =
        await test.step("Pre-arm and prove the saved Library Reaction playback", () =>
          Promise.all([prepared.open(), libraryPlayback] as const));
      await test.step("Verify the typed preview and protected sequence response", async () => {
        const preview = await previewNetwork.waitForPreview(name);
        expect(preview.selected).toMatchObject({
          kind: "reaction",
          logicalKey,
          name,
          runtimeId: name,
        });
        await previewNetwork.requireResources([`${name}.json`]);
      });
      await test.step("Attach the Library playback checkpoint", () =>
        attachPlaybackCheckpoint({
          evidence: animamaEvidence,
          locator: surface,
          name: `${JOURNEY_KEY}-library`,
          samples: librarySamples,
        }));
    } finally {
      let cleanupFailure: unknown = null;
      let guardFailure: unknown = null;
      try {
        await previewNetwork.attach(
          animamaEvidence,
          `${JOURNEY_KEY}-library-preview-network`,
        );
      } catch (error) {
        guardFailure = error;
      }
      try {
        await stopAndCloseLibraryPreview(librarySurface);
      } catch (error) {
        guardFailure ??= error;
        await animamaEvidence.attachJson(`${JOURNEY_KEY}-preview-close-error`, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
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
          const deletion = await creatorContent.assertDeletedContent(
            plan,
            owned,
          );
          await animamaEvidence.attachJson(
            `${JOURNEY_KEY}-deletion-proof`,
            deletion,
          );
        } else {
          expect(cleanup).toMatchObject({
            attempted: 0,
            deleted: 0,
            failed: 0,
          });
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
        cleanupFailure = error;
      }
      try {
        await mutationGuard.assertPolicy(animamaEvidence);
      } catch (error) {
        guardFailure ??= error;
      }
      try {
        await previewNetwork.dispose();
      } catch (error) {
        guardFailure ??= error;
      }
      try {
        await mutationGuard.dispose();
      } catch (error) {
        guardFailure ??= error;
      }
      if (cleanupFailure) throw cleanupFailure;
      if (guardFailure) throw guardFailure;
    }
  });
});
