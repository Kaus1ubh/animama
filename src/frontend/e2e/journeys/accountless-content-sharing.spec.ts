import { randomUUID } from "node:crypto";
import type { Locator, Page, Request } from "playwright/test";
import type {
  PyAnimaLoadout,
  PyLoadoutCommitResult,
  ReviewedPackageImport,
} from "@animama/runtime-contracts/api-types";
import { expect, test, type CreatorContentFixture } from "../fixtures/animama";
import { saveTrackedPose } from "../helpers/pose-content";
import {
  captureSharingState,
  commitSharingPackage,
  downloadSharingPackage,
  reviewSharingExport,
  uploadSharingPackage,
} from "../helpers/content-sharing";

const includedPose = "Shy Finger Poke 1";

/** Create only generated fixture names through the existing tracked Save surface. */
async function createPose(
  page: Page,
  content: CreatorContentFixture,
  name: string,
) {
  await page.goto("/library?section=actions&action=poses");
  await page.getByPlaceholder("Search the Library").fill(includedPose);
  await page
    .getByRole("article", { name: includedPose, exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Pose name", exact: true });
  // Included copies use the next numbered branch name before we assign our
  // unique fixture name. Save tracking below still forbids an existing ID.
  await expect(input).toHaveValue(/^Shy Finger Poke \d+$/, {
    timeout: 30_000,
  });
  await input.fill(name);
  return saveTrackedPose({ page, content, name });
}

async function openSharing(page: Page, action: "Import" | "Export") {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.goto("/library");
  const trigger = page.getByRole("button", {
    name: action,
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return trigger;
}

/**
 * Open an Anima's Loadout and return one Reaction cell's member list, with
 * its emotion row expanded.
 */
async function openReactionCell(
  page: Page,
  animaId: string,
  emotion: string,
  cell: string,
): Promise<{ section: Locator; members: Locator }> {
  const runtime = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/v1/animas/${animaId}/runtime` &&
      response.ok(),
  );
  await page.goto(`/animas/${animaId}`);
  await runtime;
  await expect(page.getByText("Loading anima", { exact: true })).toBeHidden({
    timeout: 30_000,
  });
  await page.getByRole("tab", { name: "Behavior", exact: true }).click();
  const section = page.getByRole("region", { name: "Reactions", exact: true });
  const disclosure = section.getByRole("button", {
    name: "Reactions",
    exact: true,
  });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
  // The emotion row's name also carries its Reaction count.
  const row = section.locator(
    `button[aria-controls="reaction-${emotion}-levels"]`,
  );
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  return {
    section,
    members: section.getByRole("list", { name: cell, exact: true }),
  };
}

/**
 * The imported copy of a reviewed Reaction entry: the name the review gave it
 * and its item ID from the import's receipts.
 */
function importedReaction(
  review: ReviewedPackageImport,
  receipts: ReadonlyArray<{
    plan: { kind: string; entryName: string };
    itemId: string;
  }>,
  entryId: string,
) {
  const name = review.items.find((item) => item.entry_id === entryId)?.name;
  const receipt = receipts.find(
    (entry) => entry.plan.kind === "reaction" && entry.plan.entryName === name,
  );
  expect(receipt, `imported Reaction entry ${entryId}`).toBeDefined();
  return { name: name!, itemId: receipt!.itemId };
}

/** Wait for the real completion acknowledgment before intentionally reloading. */
async function viewImportedLibrary(page: Page, stageId: string) {
  const discarded = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname ===
        `/v1/content/package-imports/${stageId}`,
  );
  await page
    .getByRole("link", { name: "View in Library", exact: true })
    .click();
  expect((await discarded).status()).toBe(204);
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("local content sharing single and multiple content export, suffix import and persistence", async ({
  page,
  creatorContent,
  animamaEvidence,
}, testInfo) => {
  test.setTimeout(240_000);
  const before = await creatorContent.snapshotLocalCatalog();
  const token = randomUUID().slice(0, 8);
  const names = [`sharing-${token}-one`, `sharing-${token}-two`];
  const sources = [];
  for (const name of names)
    sources.push(await createPose(page, creatorContent, name));
  const trigger = await openSharing(page, "Import");
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await captureSharingState(page, animamaEvidence, "sharing-01-import-entry");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Choose file", exact: true }),
  ).toBeVisible();
  await openSharing(page, "Export");
  const reviewButton = page.getByRole("button", {
    name: "Review export",
    exact: true,
  });
  await expect(reviewButton).toBeDisabled();
  const search = page.getByRole("textbox", {
    name: "Search content",
    exact: true,
  });
  await search.fill(names[0]!);
  await page.getByRole("checkbox", { name: names[0], exact: true }).check();
  await expect(reviewButton).toBeEnabled();
  // A separate, undownloaded cache can expire or be reclaimed while its review
  // is open. Back must preserve selection even when cleanup confirms absence.
  const expiredReview = await reviewSharingExport(page);
  const removed = await page.request.delete(
    `/v1/content/package-exports/${expiredReview.export_id}`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "Sec-Fetch-Site": "same-origin",
        "X-Animama-CSRF": "1",
      },
    },
  );
  expect(removed.status()).toBe(204);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .first()
    .click();
  await expect(reviewButton).toBeEnabled();
  await search.fill(names[0]!);
  await expect(
    page.getByRole("checkbox", { name: names[0], exact: true }),
  ).toBeChecked();
  await animamaEvidence.attachJson("sharing-missing-cache-back", {
    expiredExportId: expiredReview.export_id,
    selectedItemId: sources[0]!.itemId,
    exactUndownloadedCacheRemoved: true,
    selectionPreserved: true,
    reviewEnabled: true,
  });
  const single = await reviewSharingExport(page);
  expect(single.manifest.kind).toBe("content");
  expect(single.selected_count).toBe(1);
  const singleArchive = await downloadSharingPackage(
    page,
    testInfo,
    page.getByRole("button", { name: "Download package", exact: true }),
  );

  await openSharing(page, "Import");
  const singleImport = await uploadSharingPackage(page, singleArchive);
  expect(singleImport.items).toHaveLength(1);
  expect(singleImport.items[0]!.name).toBe(`${names[0]}-2`);
  await captureSharingState(page, animamaEvidence, "sharing-02-import-review");
  const commits: string[] = [];
  let newStages = 0;
  const recordRecovery = (request: Request) => {
    if (request.method() !== "POST") return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/v1/content/package-imports") newStages += 1;
    if (/\/package-imports\/[^/]+\/commit$/.test(pathname))
      commits.push(String(request.postDataJSON().operation_id));
  };
  page.on("request", recordRecovery);
  const singleOwned = await commitSharingPackage({
    page,
    content: creatorContent,
    review: singleImport,
    journeyKey: `sharing-single-${token}`,
    loseCommitReply: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  const recoveredResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/v1/content/package-operations/${singleImport.operation_id}` &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const recovered = await (await recoveredResponse).json();
  await expect(
    page.getByRole("heading", { name: "Import complete", exact: true }),
  ).toBeVisible();
  expect(recovered.result.items[0].item_id).toBe(singleOwned[0]!.itemId);
  expect(recovered.operation_id).toBe(singleImport.operation_id);
  expect(commits).toEqual([singleImport.operation_id]);
  expect(newStages).toBe(0);
  page.off("request", recordRecovery);
  await animamaEvidence.attachJson("sharing-lost-commit-response", {
    operationId: singleImport.operation_id,
    originalItemId: singleOwned[0]!.itemId,
    commitRequests: commits.length,
    additionalStageAllocations: newStages,
    serverCompletedBeforeReplyWasAborted: true,
    recoveredAfterReload: true,
  });
  expect(singleOwned[0]!.itemId).not.toBe(sources[0]!.itemId);
  await viewImportedLibrary(page, singleImport.stage_id);
  await page.reload();
  await page.getByPlaceholder("Search the Library").fill(`${names[0]}-2`);
  await expect(
    page.getByRole("article", { name: `${names[0]}-2`, exact: true }),
  ).toBeVisible();

  await openSharing(page, "Export");
  await search.fill(names[0]!);
  const first = page.getByRole("checkbox", { name: names[0], exact: true });
  if (!(await first.isChecked())) await first.check();
  await search.fill(names[1]!);
  await page.getByRole("checkbox", { name: names[1], exact: true }).check();
  await page.getByRole("button", { name: "FX", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Your package", exact: true }),
  ).toContainText("2 selected items");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await search.fill(names[0]!);
  await expect(first).toBeChecked();
  await search.fill(`sharing-${token}`);
  await first.focus();
  await expect(first).toBeFocused();
  await captureSharingState(
    page,
    animamaEvidence,
    "sharing-03-export-selection",
  );
  await expect(reviewButton).toBeEnabled();
  const multiple = await reviewSharingExport(page);
  expect(multiple.selected_count).toBe(2);
  expect(multiple.manifest.root_entry_ids).toHaveLength(2);
  const multipleArchive = await downloadSharingPackage(
    page,
    testInfo,
    page.getByRole("button", { name: "Download package", exact: true }),
  );
  await openSharing(page, "Import");
  const multipleImport = await uploadSharingPackage(page, multipleArchive);
  expect(multipleImport.items.map((item) => item.name).sort()).toEqual(
    [`${names[0]}-3`, `${names[1]}-2`].sort(),
  );
  const imported = await commitSharingPackage({
    page,
    content: creatorContent,
    review: multipleImport,
    journeyKey: `sharing-multiple-${token}`,
  });
  expect(new Set(imported.map((item) => item.itemId)).size).toBe(2);
  await viewImportedLibrary(page, multipleImport.stage_id);
  await page.reload();
  for (const item of imported) {
    await page.getByPlaceholder("Search the Library").fill(item.plan.entryName);
    await expect(
      page.getByRole("article", { name: item.plan.entryName, exact: true }),
    ).toBeVisible();
  }
  await creatorContent.cleanupOwnedContent();
  await creatorContent.assertLocalCatalogUnchanged(
    before,
    animamaEvidence,
    "sharing-content-cleanup",
  );
});

test("local content sharing complete Anima export, reviewed install, persistence and Reaction pools @complete-anima", async ({
  page,
  creatorContent,
  animamaEvidence,
}, testInfo) => {
  // The expanded starter closure has hundreds of entries; serial verification
  // and exact receipt cleanup must both finish within this bounded journey.
  test.setTimeout(2_400_000);
  const before = await creatorContent.snapshotLocalCatalog();
  await openSharing(page, "Export");
  await page.getByRole("tab", { name: "Anima", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Choose an Anima", exact: true })
    .selectOption({ label: "Annie" });
  await expect(
    page.getByRole("button", { name: "Review export", exact: true }),
  ).toBeEnabled();
  await captureSharingState(page, animamaEvidence, "sharing-04-anima-export");
  const exported = await reviewSharingExport(page);
  expect(exported.manifest.kind).toBe("anima");
  expect(exported.manifest.anima?.display_name).toBe("Annie");
  const archive = await downloadSharingPackage(
    page,
    testInfo,
    page.getByRole("button", { name: "Export Anima", exact: true }),
  );
  await openSharing(page, "Import");
  const reviewed = await uploadSharingPackage(page, archive);
  expect(reviewed.anima).not.toBeNull();
  expect(reviewed.anima!.identity_markdown).toBe(
    exported.manifest.anima!.identity_markdown,
  );
  expect(reviewed.anima!.display_name).toMatch(/^Annie-\d+$/);
  const owned = await commitSharingPackage({
    page,
    content: creatorContent,
    review: reviewed,
    journeyKey: `sharing-anima-${randomUUID().slice(0, 8)}`,
  });
  const anima = owned.find((item) => item.plan.kind === "anima")!;
  expect(anima).toBeDefined();
  await page.getByRole("button", { name: "Open Anima", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${anima.itemId}(?:[/?#]|$)`));
  await page.reload();
  await expect(
    page
      .locator("#sidebar-animas-list")
      .getByRole("link", { name: reviewed.anima!.display_name, exact: true }),
  ).toBeVisible();

  // Annie's starter Joy · Moderate pool holds two Reactions, so the complete
  // export carries a two-member pool and the import must keep it intact.
  const exportedPool = reviewed.anima!.reactions.joy!["2"]!;
  expect(exportedPool).toHaveLength(2);
  const expectedPool = exportedPool.map((entryId) =>
    importedReaction(reviewed, owned, entryId),
  );
  const moderate = await openReactionCell(
    page,
    anima.itemId,
    "joy",
    "Joy · Moderate",
  );
  await expect(moderate.members.getByRole("listitem")).toHaveCount(2);
  for (const member of expectedPool)
    await expect(
      moderate.members.getByText(member.name, { exact: true }),
    ).toBeVisible();
  const importedLoadout = await page.request.get(
    `/v1/animas/${anima.itemId}/loadout`,
  );
  expect(importedLoadout.ok(), await importedLoadout.text()).toBe(true);
  const importedModerate = (
    (await importedLoadout.json()) as PyAnimaLoadout
  ).reactions.find((cell) => cell.emotion === "joy" && cell.intensity === 2);
  expect(
    (importedModerate?.members ?? []).map((member) => member.item_id).sort(),
  ).toEqual(expectedPool.map((member) => member.itemId).sort());

  // Build a two-member pool through the Loadout: add the first Joy · Moderate
  // Reaction to Joy · Mild, which holds one, and find it after a reload.
  const starter = importedReaction(
    reviewed,
    owned,
    reviewed.anima!.reactions.joy!["1"]![0]!,
  );
  const added = expectedPool[0]!;
  const { section, members } = await openReactionCell(
    page,
    anima.itemId,
    "joy",
    "Joy · Mild",
  );
  await expect(members.getByRole("listitem")).toHaveCount(1);
  await expect(members.getByText(starter.name, { exact: true })).toBeVisible();
  await section
    .getByRole("button", { name: "Add a Reaction to Joy · Mild", exact: true })
    .click();
  // Each choice's Preview button carries its exact name; the Included
  // original has the unsuffixed one.
  const choice = page.getByRole("option").filter({
    has: page.getByRole("button", {
      name: `Preview ${added.name}`,
      exact: true,
    }),
  });
  await expect(choice).toHaveCount(1, { timeout: 15_000 });
  const committed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/v1/animas/${anima.itemId}/reactions:commit`,
  );
  await choice.getByText(added.name, { exact: true }).click();
  const commit = await committed;
  expect(commit.ok(), await commit.text()).toBe(true);
  const { aggregate_revision: aggregateRevision } =
    (await commit.json()) as PyLoadoutCommitResult;
  expect(typeof aggregateRevision).toBe("number");
  await expect(members.getByRole("listitem")).toHaveCount(2);
  // Cleanup now expects exactly this edit of the imported Anima.
  await creatorContent.recordOwnedAnimaRevision({
    animaId: anima.itemId,
    aggregateRevision: aggregateRevision!,
    revise: (definition) => ({
      ...definition,
      reactions: {
        ...definition.reactions,
        joy: {
          ...definition.reactions.joy,
          "1": [...(definition.reactions.joy?.["1"] ?? []), added.itemId],
        },
      },
    }),
  });
  await page.reload();
  const mild = await openReactionCell(page, anima.itemId, "joy", "Joy · Mild");
  await expect(mild.members.getByRole("listitem")).toHaveCount(2);
  for (const member of [starter, added])
    await expect(
      mild.members.getByText(member.name, { exact: true }),
    ).toBeVisible();
  await animamaEvidence.attachJson("sharing-anima-reaction-pool", {
    importedAnimaId: anima.itemId,
    exportedModeratePool: expectedPool.map((member) => member.name),
    addedToMild: added.name,
    editedAggregateRevision: aggregateRevision,
  });
  await animamaEvidence.attachBuffer(
    "sharing-anima-reaction-pool-imported",
    await mild.section.screenshot(),
    "image/png",
  );
  // Leave the runtime before exact receipt cleanup so its refresh cannot race deletion.
  await page.goto("/library");
  await creatorContent.cleanupOwnedContent();
  await creatorContent.assertLocalCatalogUnchanged(
    before,
    animamaEvidence,
    "sharing-anima-cleanup",
  );
});
