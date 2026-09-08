import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { Page, Request, Response, Route } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";
import { CreatorMutationGuard } from "./preview-network.ts";

class FakePage extends EventEmitter {
  routeHandler: ((route: Route) => Promise<void>) | null = null;

  async route(
    _pattern: string,
    handler: (route: Route) => Promise<void>,
  ): Promise<void> {
    this.routeHandler = handler;
  }

  async unroute(): Promise<void> {
    this.routeHandler = null;
  }

  async issue(req: Request): Promise<"continued" | "aborted"> {
    if (!this.routeHandler)
      throw new Error("Creator guard route is not attached.");
    let outcome: "continued" | "aborted" | null = null;
    await this.routeHandler({
      request: () => req,
      continue: async () => {
        outcome = "continued";
      },
      abort: async () => {
        outcome = "aborted";
      },
    } as unknown as Route);
    if (!outcome) throw new Error("Creator guard did not resolve the request.");
    return outcome;
  }
}

function request(
  method: string,
  url: string,
  options: { contentType?: string; postData?: string } = {},
): Request {
  return {
    headers: () => ({
      "content-type": options.contentType ?? "application/json",
    }),
    method: () => method,
    postData: () => options.postData ?? (method === "PUT" ? "{}" : null),
    url: () => url,
  } as unknown as Request;
}

function response(req: Request, body: unknown, status = 200): Response {
  return {
    request: () => req,
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => body,
  } as Response;
}

function evidence(): EvidenceAttachment {
  return {
    attachJson: async () => undefined,
    attachBuffer: async () => undefined,
  };
}

test("creator mutation guard binds one armed Save and exact cleanup", async () => {
  const page = new FakePage();
  const guard = await CreatorMutationGuard.attach(
    page as unknown as Page,
    "http://localhost:8000",
  );
  const recorded = [];
  guard.armSave({
    family: "reactions",
    entryName: "react-0827123456",
    logicalKey: "local:reaction:react-0827123456",
    recordOwned: async (owned) => {
      recorded.push(owned);
    },
  });

  const preview = request(
    "POST",
    "http://localhost:8000/v1/reactions/included:preview",
  );
  assert.equal(await page.issue(preview), "continued");
  const save = request(
    "PUT",
    "http://localhost:8000/v1/reactions/react-0827123456",
    {
      contentType: "multipart/form-data; boundary=creator-test",
      postData:
        '--creator-test\r\nContent-Disposition: form-data; name="operation_id"\r\n\r\nop-1\r\n--creator-test--',
    },
  );
  assert.equal(await page.issue(save), "continued");
  page.emit(
    "response",
    response(save, {
      item_id: "item-1",
      revision_sha256: "a".repeat(64),
      source: "local",
      kind: "reaction",
      logical_key: "local:reaction:react-0827123456",
      name: "react-0827123456",
      editable: true,
    }),
  );

  const owned = await guard.waitForOwned();
  assert.equal(recorded.length, 1);
  assert.deepEqual(owned, {
    itemId: "item-1",
    revisionSha256: "a".repeat(64),
    source: "local",
    kind: "reaction",
    logicalKey: "local:reaction:react-0827123456",
    name: "react-0827123456",
    editable: true,
  });
  guard.armDelete(owned);
  guard.recordExternalDelete(owned);
  await guard.assertPolicy(evidence());
  await guard.dispose();
});

test("creator mutation guard rejects second and unclassified writes", async () => {
  const page = new FakePage();
  const guard = await CreatorMutationGuard.attach(
    page as unknown as Page,
    "http://localhost:8000",
  );
  guard.armSave({
    family: "reactions",
    entryName: "react-0827123456",
    logicalKey: "local:reaction:react-0827123456",
    recordOwned: async () => undefined,
  });
  assert.equal(
    await page.issue(
      request("PUT", "http://localhost:8000/v1/reactions/another-name"),
    ),
    "aborted",
  );
  assert.equal(
    await page.issue(
      request("PUT", "http://example.test/v1/reactions/react-0827123456"),
    ),
    "aborted",
  );
  assert.equal(
    await page.issue(
      request(
        "PUT",
        "http://localhost:8000/v1/reactions/react-0827123456?mode=replace",
      ),
    ),
    "aborted",
  );
  assert.equal(
    await page.issue(
      request("POST", "http://localhost:8000/v1/animas/annie/chat:sse"),
    ),
    "aborted",
  );
  assert.equal(
    await page.issue(
      request("DELETE", "http://localhost:8000/v1/reactions/included:preview"),
    ),
    "aborted",
  );
  assert.equal(
    await page.issue(
      request("PUT", "http://localhost:8000/v1/reactions/react-0827123456", {
        contentType: "multipart/form-data; boundary=creator-test",
        postData:
          '--creator-test\r\nContent-Disposition: form-data; name="catalog_item_id"\r\n\r\nexisting-item\r\n--creator-test--',
      }),
    ),
    "aborted",
  );

  await assert.rejects(guard.assertPolicy(evidence()), /6 forbidden mutation/);
  await guard.dispose();
});

test("creator ownership rejects mismatched typed Save identities", async () => {
  for (const mismatch of [
    { source: "included" },
    { kind: "gesture" },
    { logical_key: "local:reaction:another-name" },
    { name: "another-name" },
    { editable: false },
  ]) {
    const page = new FakePage();
    const guard = await CreatorMutationGuard.attach(
      page as unknown as Page,
      "http://localhost:8000",
    );
    let ownedCount = 0;
    guard.armSave({
      family: "reactions",
      entryName: "react-0827123456",
      logicalKey: "local:reaction:react-0827123456",
      recordOwned: async () => {
        ownedCount += 1;
      },
    });
    const save = request(
      "PUT",
      "http://localhost:8000/v1/reactions/react-0827123456",
    );
    assert.equal(await page.issue(save), "continued");
    page.emit(
      "response",
      response(save, {
        item_id: "item-1",
        revision_sha256: "a".repeat(64),
        source: "local",
        kind: "reaction",
        logical_key: "local:reaction:react-0827123456",
        name: "react-0827123456",
        editable: true,
        ...mismatch,
      }),
    );

    await assert.rejects(
      guard.waitForOwned(),
      /did not match its planned editable Local identity/,
    );
    assert.equal(ownedCount, 0);
    await assert.rejects(
      guard.dispose(),
      /did not match its planned editable Local identity/,
    );
  }
});
