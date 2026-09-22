import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures/animama";
import { openCreatorStage } from "../helpers/creator-surfaces";
import {
  observePlaybackWindow,
  readPlaybackObservation,
} from "../helpers/playback-observation";
import { attachPlaybackCheckpoint } from "../helpers/checkpoints";
import { provePoseClipPlayback } from "../helpers/playback-assertions";
import {
  readPoseJson,
  roundTripPosePackage,
  saveTrackedPose,
} from "../helpers/pose-content";
import {
  PreviewNetworkRecorder,
  ReadOnlyJourneyGuard,
} from "../helpers/preview-network";
import { openLibraryPreview } from "../helpers/preview-surfaces";

const includedName = "Shy Finger Poke 1";
const posesUrl = "/a/library?section=actions&action=poses";

test("pose content Included discovery and rendered preview @read-only", async ({
  page,
  animamaEvidence,
  creatorContent,
}) => {
  test.setTimeout(120_000);
  const before = await creatorContent.snapshotLocalCatalog();
  const network = new PreviewNetworkRecorder(page);
  const guard = new ReadOnlyJourneyGuard(page);
  try {
    await page.goto("/a/library");
    await page.getByPlaceholder("Search the Library").fill(includedName);
    await expect(
      page.getByRole("article", { name: includedName, exact: true }),
    ).toBeVisible();
    const surface = await openLibraryPreview({
      page,
      contentName: includedName,
      section: "pose",
      selectAnnie: false,
    });
    const preview = await network.waitForPreview("shy-finger-poke-1");
    expect(preview.selected.kind).toBe("pose");
    const metadata = (await (await page.request.get("/v1/poses")).json()) as {
      items: Array<{ name: string; item_id: string }>;
    };
    const item = metadata.items.find((pose) => pose.name === includedName)!;
    const samples = await provePoseClipPlayback({
      evidence: animamaEvidence,
      evidenceName: "pose-content-included",
      expectedTarget: {
        kind: "anima_pose_clip",
        runtimeId: `pose-preview:${item.item_id}`,
      },
      maxMissingBones: 1,
      surface,
    });
    await network.requireResources(["shy-finger-poke-1.json"]);
    await network.attach(animamaEvidence, "pose-content-included-network");
    await attachPlaybackCheckpoint({
      evidence: animamaEvidence,
      locator: surface,
      name: "pose-content-included-rendered",
      samples,
    });
    await page.goto(posesUrl);
    await expect(page.getByRole("button", { name: /New Pose/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: /New Pose/i })).toHaveCount(0);
    await page
      .getByPlaceholder("Search the Library")
      .fill("no-such-pose-fixture");
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.getByPlaceholder("Search the Library").fill(includedName);
    await expect(
      page
        .getByRole("article", { name: includedName, exact: true })
        .getByText("Starter", { exact: true }),
    ).toHaveCount(0);
    const customize = page
      .getByRole("article", { name: includedName, exact: true })
      .getByRole("link", { name: "Edit", exact: true });
    await customize.focus();
    await expect(customize).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Pose name", exact: true }),
    ).toHaveValue(`${includedName} copy`, { timeout: 30_000 });
    await expect(
      page.getByTestId("pose-editor-canvas").locator("canvas"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New", exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("navigation", { name: "Pose tools" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Expressions", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await animamaEvidence.attachBuffer(
      "pose-content-narrow-editor",
      await page.screenshot(),
      "image/png",
    );
    await page.getByRole("link", { name: "Back to Poses" }).click();
    await expect(
      page.getByRole("dialog", { name: "Discard pose changes?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Discard and continue" }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /Create Pose|New Pose/i }),
    ).toHaveCount(0);
    await guard.assertNoMutations(animamaEvidence);
    await creatorContent.assertLocalCatalogUnchanged(before, animamaEvidence);
  } finally {
    await network.dispose();
    await guard.dispose();
  }
});

test("pose content Local save edit reopen and browser storage independence", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  test.setTimeout(180_000);
  const name = `pose-e2e-${randomUUID().slice(0, 8)}`;
  const before = await creatorContent.snapshotLocalCatalog();
  await page.goto(posesUrl);
  await page.getByPlaceholder("Search the Library").fill(includedName);
  await page
    .getByRole("article", { name: includedName, exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  const nameInput = page.getByRole("textbox", {
    name: "Pose name",
    exact: true,
  });
  await expect(nameInput).toHaveValue(`${includedName} copy`, {
    timeout: 30_000,
  });
  await nameInput.fill(name);
  const original = await readPoseJson(page);
  const saveUrl = new URL(`/v1/poses/${name}`, page.url()).href;
  await page.route(
    saveUrl,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Fixture save failure" }),
      }),
    { times: 1 },
  );
  const failure = page.waitForResponse(
    (response) => response.url() === saveUrl && response.status() === 503,
  );
  await page.getByRole("button", { name: "Save pose", exact: true }).click();
  await failure;
  await expect(nameInput).toHaveValue(name);
  await expect(
    page.getByRole("button", { name: "Save pose", exact: true }),
  ).toBeEnabled();
  expect(await readPoseJson(page)).toEqual(original);
  let owned = await saveTrackedPose({ page, content: creatorContent, name });
  await page.getByRole("link", { name: "Back to Poses" }).click();
  await page.getByPlaceholder("Search the Library").fill(name);
  await page
    .getByRole("article", { name, exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  await expect(nameInput).toHaveValue(name, { timeout: 30_000 });
  const reopened = await readPoseJson(page);
  expect(reopened.humanoid).toEqual(original.humanoid);
  expect(reopened.expressions).toEqual(original.expressions);
  // The second surface holds an inline copy while its source is edited and deleted.
  const clipPage = await page.context().newPage();
  await clipPage.goto("/a/create");
  const stage = await openCreatorStage({
    creator: "Gesture",
    page: clipPage,
    selectAnnie: false,
  });
  await clipPage
    .getByRole("button", {
      name: `Insert ${name} at current playhead`,
      exact: true,
    })
    .click();
  const readClip = async () => {
    await clipPage.bringToFront();
    const viewJson = clipPage.getByRole("button", {
      name: "View JSON",
      exact: true,
    });
    await viewJson.focus();
    await viewJson.press("Enter");
    const dialog = clipPage.getByRole("dialog", {
      name: "Creator JSON",
      exact: true,
    });
    const clip = JSON.parse(
      await dialog
        .getByRole("textbox", { name: "Creator JSON preview" })
        .inputValue(),
    ) as Record<string, unknown>;
    await clipPage.keyboard.press("Escape");
    return clip;
  };
  const copiedClip = await readClip();
  const copiedPoses = Object.entries(
    copiedClip.poses as Record<
      string,
      {
        humanoid?: Record<string, { rotation?: number[] }>;
        expressions?: Record<string, number>;
      }
    >,
  ).filter(([key]) => key !== "base");
  expect(copiedPoses).toHaveLength(1);
  const copiedPose = copiedPoses[0]![1];
  expect(copiedPose.expressions).toEqual(original.expressions);
  for (const [bone, transform] of Object.entries(
    original.humanoid as Record<string, { rotation?: number[] }>,
  )) {
    transform.rotation?.forEach((value, index) =>
      expect(copiedPose.humanoid?.[bone]?.rotation?.[index]).toBeCloseTo(
        value,
        12,
      ),
    );
  }
  expect(JSON.stringify(copiedClip)).not.toContain(owned.plan.logicalKey);
  expect(JSON.stringify(copiedClip)).not.toContain(owned.itemId);
  await animamaEvidence.attachJson(
    "pose-content-inline-copy-before-source-change",
    copiedClip,
  );
  await nameInput.fill(`${name}-edited`);
  await page.getByRole("link", { name: "Back to Poses" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard pose changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(nameInput).toHaveValue(`${name}-edited`);
  const previousRevision = owned.revisionSha256;
  owned = await saveTrackedPose({
    page,
    content: creatorContent,
    name: `${name}-edited`,
    previous: owned,
  });
  expect(owned.revisionSha256).not.toBe(previousRevision);
  expect(await readClip()).toEqual(copiedClip);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "anima.poseCreator.localDrafts.v1",
      JSON.stringify({
        schema: "poseCreatorLocalDrafts/1.0",
        drafts: [
          {
            id: "legacy-browser-pose",
            name: "legacy-browser-pose",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            basePose: "vrmTPose",
            source: {
              key: "fixture-avatar",
              displayName: "Fixture Avatar",
              versionLabel: "v1",
              sourceLabel: "Preview Anima",
              sourceType: "resolved_entry",
            },
            pose: {
              schema: "animaPose/1.0",
              id: "legacy-browser-pose",
              name: "legacy-browser-pose",
              humanoid: { head: { rotation: [0, 0, 0, 1] } },
              expressions: { happy: 1 },
            },
          },
        ],
      }),
    );
  });
  await page.reload();
  await expect(nameInput).toHaveValue(`${name}-edited`, { timeout: 30_000 });
  const persisted = await readPoseJson(page);
  expect(persisted.humanoid).toEqual(original.humanoid);
  expect(persisted.expressions).toEqual(original.expressions);
  await page.getByRole("link", { name: "Back to Poses" }).click();
  await page.getByPlaceholder("Search the Library").fill("legacy-browser-pose");
  await expect(page.getByRole("article")).toHaveCount(0);
  const surface = await openLibraryPreview({
    page,
    contentName: `${name}-edited`,
    origin: "Mine",
    section: "pose",
    selectAnnie: false,
  });
  const samples = await provePoseClipPlayback({
    evidence: animamaEvidence,
    evidenceName: "pose-content-local",
    expectedTarget: {
      kind: "anima_pose_clip",
      runtimeId: `pose-preview:${owned.itemId}`,
    },
    maxMissingBones: 1,
    surface,
  });
  await attachPlaybackCheckpoint({
    evidence: animamaEvidence,
    locator: surface,
    name: "pose-content-local-rendered",
    samples,
  });
  owned = await roundTripPosePackage(page, creatorContent, owned);
  expect(await readClip()).toEqual(copiedClip);
  await clipPage.bringToFront();
  const clipRuntimeId = (await readPlaybackObservation(stage.surface)).target
    .runtimeId;
  // Authoring applies skeleton transforms directly; its public observation reports
  // expressions and playhead but does not count resolved animation bones.
  const copyPlayback = observePlaybackWindow({
    evidence: animamaEvidence,
    evidenceName: "pose-content-independent-copy",
    expectedTarget: { kind: "anima_pose_clip", runtimeId: clipRuntimeId },
    surface: stage.surface,
    surfaceKind: "creator-stage",
    until: (observations) => {
      const times = observations.map(
        (sample) => sample.motion.poseClip?.playheadSec ?? 0,
      );
      return (
        Math.max(...times) - Math.min(...times) > 0.04 &&
        observations.some(
          (sample) =>
            sample.motion.poseClip?.active &&
            (sample.expressions.sad ?? 0) > 0.2,
        )
      );
    },
  });
  const [, copySamples] = await Promise.all([
    clipPage
      .getByRole("button", { name: "Restart clip preview", exact: true })
      .click(),
    copyPlayback,
  ]);
  await attachPlaybackCheckpoint({
    evidence: animamaEvidence,
    locator: stage.surface,
    name: "pose-content-independent-copy-rendered",
    samples: copySamples,
  });
  await clipPage.close();
  await page.reload();
  const importedSurface = await openLibraryPreview({
    page,
    contentName: `${name}-edited`,
    origin: "Mine",
    section: "pose",
    selectAnnie: false,
  });
  const importedSamples = await provePoseClipPlayback({
    evidence: animamaEvidence,
    evidenceName: "pose-content-imported",
    expectedTarget: {
      kind: "anima_pose_clip",
      runtimeId: `pose-preview:${owned.itemId}`,
    },
    maxMissingBones: 1,
    surface: importedSurface,
  });
  await attachPlaybackCheckpoint({
    evidence: animamaEvidence,
    locator: importedSurface,
    name: "pose-content-imported-rendered",
    samples: importedSamples,
  });
  await creatorContent.cleanupOwnedContent();
  await creatorContent.assertDeletedContent(owned.plan, owned);
  await creatorContent.assertLocalCatalogUnchanged(before, animamaEvidence);
});

test("pose content editor recovers a failed detail load without creating content", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  const before = await creatorContent.snapshotLocalCatalog();
  await page.goto(posesUrl);
  const row = page.getByRole("article", { name: includedName, exact: true });
  const href = await row
    .getByRole("link", { name: "Edit", exact: true })
    .getAttribute("href");
  expect(href).toBeTruthy();
  const itemId = new URL(href!, page.url()).pathname.split("/")[3]!;
  const detailUrl = new URL(`/v1/poses/${itemId}`, page.url()).href;
  await page.route(detailUrl, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Fixture temporary failure" }),
    }),
  );
  await row.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Pose could not be loaded.",
    { timeout: 20_000 },
  );
  await expect(
    page.getByRole("button", { name: "Save pose", exact: true }),
  ).toBeDisabled();
  await page.unroute(detailUrl);
  await page.getByRole("button", { name: "Retry pose", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Pose name", exact: true }),
  ).toHaveValue(`${includedName} copy`, { timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await creatorContent.assertLocalCatalogUnchanged(before, animamaEvidence);
});

test("pose content creator load panels avoid expanded and collapsed sidebars @read-only", async ({
  page,
  creatorContent,
  animamaEvidence,
}) => {
  const before = await creatorContent.snapshotLocalCatalog();
  const guard = new ReadOnlyJourneyGuard(page);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const creator of ["pose", "gesture", "reaction"] as const) {
      await page.goto(
        creator === "reaction" ? "/a/reactions/new" : "/a/gestures/new",
      );
      if (creator !== "reaction") {
        await page
          .getByRole("tab", {
            name: creator === "pose" ? "Pose" : "Clip",
            exact: true,
          })
          .click();
      }
      for (const expanded of [false, true]) {
        await expect(
          page.getByRole("button", { name: /^(Open|Close) sidebar$/ }),
        ).toBeVisible();
        const toggle = page.getByRole("button", {
          name: expanded ? "Open sidebar" : "Close sidebar",
          exact: true,
        });
        if (await toggle.isVisible()) await toggle.click();
        await expect(
          page.getByRole("button", {
            name: expanded ? "Close sidebar" : "Open sidebar",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: `Load ${creator}`, exact: true })
          .press("Enter");
        const panel = page.locator('[data-slot="popover-content"]');
        await expect(panel).toBeVisible();
        await expect
          .poll(async () => {
            const box = await panel.boundingBox();
            return Boolean(
              box &&
              box.x >= (expanded ? 242 : 56) &&
              box.x + box.width <= 1280,
            );
          })
          .toBe(true);
        if (creator === "pose") {
          await expect(
            panel.getByText("Included and Local content", { exact: true }),
          ).toHaveCount(0);
          for (const name of [
            "Relaxed Rest",
            "Shy Finger Poke 1",
            "Shy Finger Poke 2",
            "Thinking Head Scratch 1",
            "Thinking Head Scratch 2",
          ]) {
            await expect(
              panel.getByRole("button", {
                name: `Delete ${name}`,
                exact: true,
              }),
            ).toHaveCount(0);
            await expect(panel.getByText(name, { exact: true })).toBeVisible();
          }
        }
        await animamaEvidence.attachBuffer(
          `load-${creator}-${expanded ? "expanded" : "collapsed"}`,
          await page.screenshot(),
          "image/png",
        );
        await page.keyboard.press("Escape");
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Load reaction", exact: true })
      .click();
    const panel = page.locator('[data-slot="popover-content"]');
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return Boolean(box && box.x >= 0 && box.x + box.width <= 390);
      })
      .toBe(true);
    await guard.assertNoMutations(animamaEvidence);
    await creatorContent.assertLocalCatalogUnchanged(before, animamaEvidence);
  } finally {
    await guard.dispose();
  }
});
