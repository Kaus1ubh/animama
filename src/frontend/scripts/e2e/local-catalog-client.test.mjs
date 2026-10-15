import assert from "node:assert/strict";
import test from "node:test";

import {
  animaDefinitionSha256,
  createLocalCatalogClient,
  localCatalogSnapshot,
} from "./local-catalog-client.mjs";

function response(status, body = null) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => body,
  };
}

test("uses same-origin CSRF metadata for exact accountless catalog operations", async () => {
  const calls = [];
  const contexts = [];
  const requestFactory = async (options) => {
    contexts.push(options);
    return {
      get: async (url) => {
        calls.push(["GET", url]);
        if (url === "/v1/content/catalog") return response(200, { items: [] });
        if (url === "/v1/animas/annie-id/loadout") {
          return response(200, { anima_id: "annie-id", revision: 3 });
        }
        if (url === "/v1/content/package-operations/import-operation") {
          return response(200, {
            operation_id: "import-operation",
            state: "completed",
          });
        }
        if (url.includes("missing")) return response(404, {});
        return response(200, { item_id: "item-1" });
      },
      delete: async (url, options) => {
        calls.push(["DELETE", url, options.params.expected_revision]);
        return response(204);
      },
      dispose: async () => undefined,
    };
  };
  const client = await createLocalCatalogClient({
    apiUrl: "http://localhost:8620",
    requestFactory,
  });

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].storageState, undefined);
  assert.equal(contexts[0].extraHTTPHeaders.authorization, undefined);
  assert.equal(contexts[0].extraHTTPHeaders.Origin, "http://localhost:8620");
  assert.equal(contexts[0].extraHTTPHeaders["X-Animama-CSRF"], "1");
  assert.equal(contexts[0].extraHTTPHeaders["Sec-Fetch-Site"], "same-origin");
  assert.deepEqual(await client.listCatalog(), { items: [] });
  assert.deepEqual(await client.getItem("item-1"), { item_id: "item-1" });
  assert.equal(await client.getItem("missing", { allowMissing: true }), null);
  assert.deepEqual(await client.getAnimaLoadout("annie-id"), {
    anima_id: "annie-id",
    revision: 3,
  });
  assert.deepEqual(await client.getPackageOperation("import-operation"), {
    operation_id: "import-operation",
    state: "completed",
  });
  await assert.rejects(
    client.getPackageOperation("../guessed"),
    /exact operation ID/,
  );
  assert.deepEqual(await client.deleteItem("item-1", "a".repeat(64)), {
    status: 204,
  });
  assert.deepEqual(calls, [
    ["GET", "/v1/content/catalog"],
    ["GET", "/v1/content/items/item-1"],
    ["GET", "/v1/content/items/missing"],
    ["GET", "/v1/animas/annie-id/loadout"],
    ["GET", "/v1/content/package-operations/import-operation"],
    ["DELETE", "/v1/content/items/item-1", "a".repeat(64)],
  ]);
  await client.close();
});

test("refuses non-loopback targets before opening a request context", async () => {
  let called = false;
  await assert.rejects(
    createLocalCatalogClient({
      apiUrl: "https://example.com",
      requestFactory: async () => {
        called = true;
      },
    }),
    /bare loopback/,
  );
  assert.equal(called, false);
});

test("catalog snapshots are deterministic and Local-only", () => {
  const snapshot = localCatalogSnapshot({
    items: [
      {
        item_id: "included",
        source: "included",
        kind: "reaction",
      },
      {
        item_id: "local-2",
        source: "local",
        kind: "reaction",
        logical_key: "local:reaction:b",
        display_name: "B",
        revision_sha256: "b".repeat(64),
        relative_locator: "reactions/b",
      },
      {
        item_id: "local-1",
        source: "local",
        kind: "gesture",
        logical_key: "local:gesture:a",
        display_name: "A",
        revision_sha256: "a".repeat(64),
        relative_locator: "gestures/a.vrma",
      },
    ],
  });
  assert.equal(snapshot.itemCount, 2);
  assert.deepEqual(
    snapshot.items.map((item) => item.itemId),
    ["local-1", "local-2"],
  );
  assert.match(snapshot.sha256, /^[0-9a-f]{64}$/);
});

test("Anima definition digests ignore Idle and Reaction pool member order only", () => {
  const anima = (first, second) => ({
    display_name: "Fixture",
    gestures: [{ entry_id: "a" }, { entry_id: "b" }],
    reactions: { joy: { 1: [], 4: [first, second] } },
    idle: {
      default: [first, second],
      cells: { joy: { 2: [second, first] } },
    },
  });
  assert.equal(
    animaDefinitionSha256(anima("a", "b")),
    animaDefinitionSha256(anima("b", "a")),
  );
  assert.notEqual(
    animaDefinitionSha256(anima("a", "b")),
    animaDefinitionSha256({
      ...anima("a", "b"),
      gestures: [{ entry_id: "b" }, { entry_id: "a" }],
    }),
  );
  assert.notEqual(
    animaDefinitionSha256(anima("a", "b")),
    animaDefinitionSha256(anima("a", "c")),
  );
});

test("catalog failures report status without exposing response bodies", async () => {
  const client = await createLocalCatalogClient({
    apiUrl: "http://localhost:8620",
    requestFactory: async () => ({
      get: async () => response(403, { secret: "must-not-leak" }),
      dispose: async () => undefined,
    }),
  });
  await assert.rejects(
    client.listCatalog(),
    (error) => error.message === "Neutral catalog read returned HTTP 403.",
  );
  await client.close();
});

test("releases one exact package stage and reports only its stable code", async () => {
  const calls = [];
  const client = await createLocalCatalogClient({
    apiUrl: "http://localhost:8620",
    requestFactory: async () => ({
      delete: async (url, options) => {
        calls.push([url, options.failOnStatusCode]);
        return url.includes("imports")
          ? response(204)
          : response(409, {
              detail: { code: "package_stage_active" },
              secret: "must-not-leak",
            });
      },
      dispose: async () => undefined,
    }),
  });
  const stageId = "a".repeat(32);
  assert.deepEqual(await client.discardPackageStage("import", stageId), {
    status: 204,
    code: null,
  });
  assert.deepEqual(await client.discardPackageStage("export", stageId), {
    status: 409,
    code: "package_stage_active",
  });
  await assert.rejects(
    client.discardPackageStage("import", "../guessed"),
    /exact package stage/,
  );
  await assert.rejects(
    client.discardPackageStage("upload", stageId),
    /exact package stage/,
  );
  assert.deepEqual(calls, [
    [`/v1/content/package-imports/${stageId}`, false],
    [`/v1/content/package-exports/${stageId}`, false],
  ]);
  await client.close();
});
