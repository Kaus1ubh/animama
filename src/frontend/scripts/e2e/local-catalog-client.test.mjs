import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("uses UI storageState for the token exchange and exact catalog operations", async () => {
  const calls = [];
  const contexts = [];
  const requestFactory = async (options) => {
    contexts.push(options);
    const auth = contexts.length === 1;
    return {
      get: async (url) => {
        calls.push(["GET", url]);
        if (auth) return response(200, { token: "secret-jwt" });
        if (url === "/v1/content/catalog") return response(200, { items: [] });
        if (url === "/v1/animas/annie-id/loadout") {
          return response(200, { anima_id: "annie-id", revision: 3 });
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
    authUrl: "http://localhost:3000",
    apiUrl: "http://127.0.0.1:8000",
    storageStatePath: "/tmp/storage-state.json",
    requestFactory,
  });

  assert.equal(contexts[0].storageState, "/tmp/storage-state.json");
  assert.equal(contexts[0].extraHTTPHeaders.authorization, undefined);
  assert.equal(contexts[1].extraHTTPHeaders.authorization, "Bearer secret-jwt");
  assert.deepEqual(await client.listCatalog(), { items: [] });
  assert.deepEqual(await client.getItem("item-1"), { item_id: "item-1" });
  assert.equal(await client.getItem("missing", { allowMissing: true }), null);
  assert.deepEqual(await client.getAnimaLoadout("annie-id"), {
    anima_id: "annie-id",
    revision: 3,
  });
  assert.deepEqual(await client.deleteItem("item-1", "a".repeat(64)), {
    status: 204,
  });
  assert.deepEqual(calls, [
    ["GET", "/api/auth/token"],
    ["GET", "/v1/content/catalog"],
    ["GET", "/v1/content/items/item-1"],
    ["GET", "/v1/content/items/missing"],
    ["GET", "/v1/animas/annie-id/loadout"],
    ["DELETE", "/v1/content/items/item-1", "a".repeat(64)],
  ]);
  await client.close();
});

test("refuses non-loopback targets before opening a request context", async () => {
  let called = false;
  await assert.rejects(
    createLocalCatalogClient({
      authUrl: "https://auth.example.com",
      apiUrl: "http://localhost:8000",
      storageStatePath: "/tmp/storage-state.json",
      requestFactory: async () => {
        called = true;
      },
    }),
    /non-loopback/,
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

test("auth failures never echo token response bodies or auth URLs", async () => {
  await assert.rejects(
    createLocalCatalogClient({
      authUrl: "http://localhost:3000/private-token-url",
      apiUrl: "http://localhost:8000",
      storageStatePath: "/tmp/storage-state.json",
      requestFactory: async () => ({
        get: async () => response(401, { token: "must-not-leak" }),
        dispose: async () => undefined,
      }),
    }),
    (error) =>
      error.message === "Local E2E token acquisition failed (HTTP 401)." &&
      !error.message.includes("must-not-leak") &&
      !error.message.includes("private-token-url"),
  );
});
