import {
  expect,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "playwright/test";
import type {
  ExportReview,
  ReviewedPackageImport,
} from "@animama/runtime-contracts/api-types";
import type {
  CreatorContentFixture,
  CreatorPackageImportPlan,
  EvidenceAttachment,
} from "../fixtures/animama";

/** Screenshot only the disposable fixture, at the same desktop/narrow comparison sizes. */
export async function captureSharingState(
  page: Page,
  evidence: EvidenceAttachment,
  name: string,
) {
  const dialog = page.getByRole("dialog");
  const settledDialog = () =>
    expect
      .poll(async () => {
        const bounds = await dialog.boundingBox();
        const viewport = page.viewportSize();
        return Boolean(
          bounds &&
          viewport &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= viewport.width &&
          bounds.y + bounds.height <= viewport.height,
        );
      })
      .toBe(true);
  const finalAction = page.getByRole("button", {
    name: /^(Choose what to export|Review export|Import (?:Anima|\d+ items?))$/,
  });
  await settledDialog();
  await expect(finalAction).toBeInViewport();
  await evidence.attachBuffer(
    `${name}-desktop`,
    await page.screenshot({ animations: "disabled" }),
    "image/png",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  // Wait through responsive layout before recording the narrow comparison.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await settledDialog();
  await expect(finalAction).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await evidence.attachBuffer(
    `${name}-narrow`,
    await page.screenshot({ animations: "disabled" }),
    "image/png",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(finalAction).toBeInViewport();
}

/** Download through the actual browser save path and retain the test's private artifact. */
export async function downloadSharingPackage(
  page: Page,
  testInfo: TestInfo,
  button: Locator,
) {
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const destination = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  return destination;
}

/** Observe server review facts while the user performs the real prepare action. */
export async function reviewSharingExport(page: Page): Promise<ExportReview> {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/content/package-exports",
  );
  await page
    .getByRole("button", { name: "Review export", exact: true })
    .click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<ExportReview>;
}

/** Real file picker/upload/review; no API shortcut substitutes for the sharing UI. */
export async function uploadSharingPackage(
  page: Page,
  file: string,
): Promise<ReviewedPackageImport> {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/v1\/content\/package-imports\/[^/]+\/review$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page
    .getByLabel("Choose .zip file", { exact: true })
    .setInputFiles(file);
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  const review = (await response.json()) as ReviewedPackageImport;
  await expect(
    page.getByRole("heading", { name: "Review import", exact: true }),
  ).toBeVisible();
  return review;
}

/** Fsync all reviewed identities before dispatch; uncertain results remain recoverable in the ledger. */
export async function commitSharingPackage(args: {
  page: Page;
  content: CreatorContentFixture;
  review: ReviewedPackageImport;
  journeyKey: string;
  loseCommitReply?: boolean;
}) {
  const { page, content, review, journeyKey } = args;
  const url = new URL(
    `/v1/content/package-imports/${review.stage_id}/commit`,
    page.url(),
  ).href;
  let resolve!: (plans: CreatorPackageImportPlan[]) => void;
  let reject!: (error: unknown) => void;
  const recorded = new Promise<CreatorPackageImportPlan[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void recorded.catch(() => undefined);
  const handler = async (route: Route) => {
    try {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        operation_id: review.operation_id,
        review_digest: review.review_digest,
      });
      const plans = await content.planWholePackageImport(review, journeyKey);
      let response;
      if (args.loseCommitReply) {
        response = await route.fetch({
          // Browser fetch metadata is not forwarded by Playwright's API
          // transport, so preserve the same-origin gateway assertion here.
          headers: {
            ...route.request().headers(),
            "Sec-Fetch-Site": "same-origin",
          },
        });
        // The real server has completed; only its browser response is lost.
        await route.abort("failed");
      } else {
        const pending = page.waitForResponse(
          (candidate) => candidate.request() === route.request(),
          { timeout: 90_000 },
        );
        await route.continue();
        response = await pending;
      }
      expect(response.ok(), await response.text()).toBe(true);
      resolve(plans);
    } catch (error) {
      reject(error);
      await route.abort().catch(() => undefined);
    }
  };
  await page.route(url, handler, { times: 1 });
  try {
    await page
      .getByRole("button", {
        name: review.anima ? "Import Anima" : /^Import \d+ items?$/,
        exact: true,
      })
      .click();
    const plans = await recorded;
    const owned = [];
    for (const plan of plans) {
      const result = await content.resolvePackageImport(plan);
      if (result.plan.kind !== "anima")
        await content.verifyOwnedContent(result.plan, result);
      owned.push(result);
    }
    await expect(
      page.getByRole("heading", {
        name: args.loseCommitReply ? "Import status" : "Import complete",
        exact: true,
      }),
    ).toBeVisible();
    return owned;
  } finally {
    await page.unroute(url, handler);
  }
}
