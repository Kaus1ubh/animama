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
    await expect(page).toHaveURL(new RegExp(`/poses/${saved.itemId}/edit`));
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

/** Exercise whole-package review/commit with receipt-backed exact cleanup ownership. */
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
  const summaryResponse = await page.request.post(
    "/v1/content/package-exports:summary",
    {
      headers,
      data: { item_ids: [source.itemId] },
    },
  );
  expect(summaryResponse.ok()).toBe(true);
  const summary = await summaryResponse.json();
  const preparedResponse = await page.request.post(
    "/v1/content/package-exports",
    {
      headers,
      data: { item_ids: [source.itemId], expected_digest: summary.digest },
    },
  );
  expect(preparedResponse.ok()).toBe(true);
  const prepared = await preparedResponse.json();
  let archive: Buffer;
  try {
    const exported = await page.request.get(
      `/v1/content/package-exports/${prepared.export_id}/file`,
      { headers },
    );
    expect(exported.ok()).toBe(true);
    archive = await exported.body();
    expect(archive.length).toBe(prepared.size_bytes);
  } finally {
    const discarded = await page.request.delete(
      `/v1/content/package-exports/${prepared.export_id}`,
      { headers },
    );
    expect(discarded.status()).toBe(204);
  }
  await content.cleanupOwnedContent();
  await content.assertDeletedContent(source.plan, source);
  const operationId = `import-${source.itemId}`;
  const allocated = await page.request.post("/v1/content/package-imports", {
    headers,
    data: {
      operation_id: operationId,
      filename: "pose.zip",
      expected_size_bytes: archive.length,
    },
  });
  expect(allocated.ok()).toBe(true);
  const stage = await allocated.json();
  let commitDispatched = false;
  let completed = false;
  try {
    expect(stage.part_size_bytes).toBeGreaterThan(0);
    for (
      let offset = 0, index = 0;
      offset < archive.length;
      offset += stage.part_size_bytes, index += 1
    ) {
      const part = await page.request.put(
        `/v1/content/package-imports/${stage.stage_id}/parts/${index}`,
        {
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          data: archive.subarray(offset, offset + stage.part_size_bytes),
        },
      );
      expect(part.ok(), await part.text()).toBe(true);
    }
    const inspected = await page.request.post(
      `/v1/content/package-imports/${stage.stage_id}/review`,
      { headers },
    );
    expect(inspected.ok(), await inspected.text()).toBe(true);
    const review = await inspected.json();
    expect(review.kind).toBe("content");
    expect(review.items).toHaveLength(1);
    const item = review.items[0];
    expect(item.kind).toBe("pose");
    const plan = await content.planPackageImport({
      journeyKey: `pose-package-${source.plan.entryName}`,
      kind: "pose",
      entryName: item.name,
      operationId,
      stageId: stage.stage_id,
      reviewDigest: review.review_digest,
      entryId: item.entry_id,
    });
    // The fsynced operation plan precedes dispatch. A lost reply is resolved by
    // its receipt, including the original revision, never by a generated name.
    commitDispatched = true;
    let commitProblem = "";
    try {
      const committed = await page.request.post(
        `/v1/content/package-imports/${stage.stage_id}/commit`,
        {
          headers,
          data: {
            operation_id: operationId,
            review_digest: review.review_digest,
          },
        },
      );
      if (!committed.ok()) commitProblem = `Commit HTTP ${committed.status()}`;
    } catch (error) {
      commitProblem = String(error);
    }
    const statusResponse = await page.request.get(
      `/v1/content/package-operations/${encodeURIComponent(operationId)}`,
      { headers },
    );
    expect(statusResponse.ok(), commitProblem).toBe(true);
    const status = await statusResponse.json();
    expect(
      status.state,
      commitProblem || "The import outcome must be confirmed by its receipt",
    ).toBe("completed");
    expect(status.review_digest).toBe(review.review_digest);
    const owned = await content.resolvePackageImport(plan);
    expect(owned.itemId).not.toBe(source.itemId);
    expect(owned.plan.logicalKey).not.toBe(source.plan.logicalKey);
    await content.verifyOwnedContent(owned.plan, owned);
    completed = true;
    return owned;
  } finally {
    if (!commitDispatched || completed) {
      const discarded = await page.request.delete(
        `/v1/content/package-imports/${stage.stage_id}`,
        { headers },
      );
      expect(discarded.status()).toBe(204);
    }
  }
}
