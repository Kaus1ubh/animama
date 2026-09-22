import { expect, type Page, type Route } from "playwright/test";
import type {
  CreatorContentFixture,
  CreatorContentPlan,
} from "../fixtures/animama";

export type OwnedPose = {
  plan: CreatorContentPlan;
  itemId: string;
  revisionSha256: string;
};

/** Fsync a plan before the real browser request and bind ownership before the test proceeds. */
export async function saveTrackedPose(args: {
  page: Page;
  content: CreatorContentFixture;
  name: string;
  previous?: OwnedPose;
}): Promise<OwnedPose> {
  const { page, content, name, previous } = args;
  const url = new URL(`/v1/poses/${encodeURIComponent(name)}`, page.url()).href;
  let resolve!: (value: OwnedPose) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<OwnedPose>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void result.catch(() => undefined);
  const handler = async (route: Route) => {
    try {
      const request = route.request();
      expect(request.method()).toBe("PUT");
      const fields = await new Response(request.postData(), {
        headers: { "content-type": request.headers()["content-type"]! },
      }).formData();
      const descriptor = JSON.parse(
        String(fields.get("descriptor_json")),
      ) as Record<string, unknown>;
      expect(descriptor.name).toBe(name);
      expect(descriptor.content_type).toBe("pose");
      const logicalKey = String(descriptor.content_id);
      let plan: CreatorContentPlan;
      if (previous) {
        expect(fields.get("catalog_item_id")).toBe(previous.itemId);
        expect(fields.get("expected_revision")).toBe(previous.revisionSha256);
        expect(logicalKey).toBe(previous.plan.logicalKey);
        plan = previous.plan;
      } else {
        expect(fields.get("catalog_item_id")).toBeNull();
        expect(fields.get("expected_revision")).toBeNull();
        expect(logicalKey).toMatch(/^local:pose:/);
        await content.preflightContentAbsence({
          logicalKey,
          expectedRelativePath: `poses/${name}`,
        });
        plan = await content.planContent({
          journeyKey: `pose-content-${name}`,
          kind: "pose",
          entryName: name,
          logicalKey,
        });
      }
      const responsePending = page.waitForResponse(
        (candidate) => candidate.request() === request,
      );
      await route.continue();
      const response = await responsePending;
      expect(
        response.ok(),
        `Pose save returned ${response.status()}: ${await response.text()}`,
      ).toBe(true);
      const body = (await response.json()) as Record<string, unknown>;
      const owned = {
        itemId: String(body.item_id),
        revisionSha256: String(body.revision_sha256),
      };
      if (previous)
        await content.recordOwnedContentRevision(plan, previous, owned);
      else await content.recordOwnedContent(plan, owned);
      resolve({ plan, ...owned });
    } catch (error) {
      reject(error);
      await route.abort().catch(() => undefined);
    }
  };
  await page.route(url, handler, { times: 1 });
  try {
    await page.getByRole("button", { name: "Save pose", exact: true }).click();
    const saved = await result;
    await content.verifyOwnedContent(saved.plan, saved);
    await expect(page).toHaveURL(new RegExp(`/a/poses/${saved.itemId}/edit`));
    await expect(
      page.getByRole("button", { name: "Save pose", exact: true }),
    ).toBeDisabled();
    return saved;
  } finally {
    await page.unroute(url, handler);
  }
}

/** Read the visible editor export without reaching into its store. */
export async function readPoseJson(
  page: Page,
): Promise<Record<string, unknown>> {
  await page
    .getByRole("button", { name: "View pose JSON", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Pose JSON", exact: true });
  await expect(dialog).toBeVisible();
  const json = JSON.parse(
    await dialog
      .getByRole("textbox", { name: "Pose JSON preview" })
      .inputValue(),
  ) as Record<string, unknown>;
  await page.keyboard.press("Escape");
  return json;
}

/** Exercise the package HTTP surface (the Library has no package import UI). */
export async function roundTripPosePackage(
  page: Page,
  content: CreatorContentFixture,
  source: OwnedPose,
): Promise<OwnedPose> {
  const origin = new URL(page.url()).origin;
  const headers = {
    Origin: origin,
    "Sec-Fetch-Site": "same-origin",
    "X-Animama-CSRF": "1",
  };
  const exported = await page.request.post(
    `/v1/content/items/${source.itemId}:export?operation_id=export-${source.itemId}`,
    { headers },
  );
  expect(exported.ok()).toBe(true);
  const archive = await exported.body();
  await content.cleanupOwnedContent();
  await content.assertDeletedContent(source.plan, source);
  await content.preflightContentAbsence({
    logicalKey: source.plan.logicalKey,
    expectedRelativePath: `poses/${source.plan.entryName}`,
  });
  const plan = await content.planContent({
    journeyKey: `pose-package-${source.plan.entryName}`,
    kind: "pose",
    entryName: source.plan.entryName,
    logicalKey: source.plan.logicalKey,
  });
  const response = await page.request.post("/v1/content/packages:import", {
    headers,
    multipart: {
      operation_id: `import-${source.itemId}`,
      collision: "cancel",
      package: {
        name: "pose.animama",
        mimeType: "application/vnd.animama.content+zip",
        buffer: archive,
      },
    },
  });
  expect(
    response.ok(),
    `Package import returned ${response.status()}: ${await response.text()}`,
  ).toBe(true);
  const imported = (await response.json()) as {
    items: Array<{ item_id: string; revision_sha256: string }>;
  };
  expect(imported.items).toHaveLength(1);
  const item = imported.items[0]!;
  const owned = {
    plan,
    itemId: item.item_id,
    revisionSha256: item.revision_sha256,
  };
  await content.recordOwnedContent(plan, owned);
  await content.verifyOwnedContent(plan, owned);
  return owned;
}
