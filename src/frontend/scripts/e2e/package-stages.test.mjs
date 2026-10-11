import assert from "node:assert/strict";
import test from "node:test";

import { PackageStageLedger, releasePackageStages } from "./package-stages.mjs";

const origin = "http://animama-a.localhost:8600";
const exportId = "a".repeat(32);
const importId = "b".repeat(32);

function observed(method, path, status, body = null) {
  return {
    method,
    url: `${origin}${path}`,
    status,
    json: async () => body,
  };
}

test("tracks stages the browser opened until the browser releases them", async () => {
  const ledger = new PackageStageLedger();
  await ledger.observe(
    observed("POST", "/v1/content/package-exports", 200, {
      export_id: exportId,
    }),
  );
  await ledger.observe(
    observed("POST", "/v1/content/package-imports", 201, {
      stage_id: importId,
    }),
  );
  // Reads, refusals and other package routes neither open nor release stages.
  await ledger.observe(
    observed("POST", "/v1/content/package-exports:summary", 200, {
      digest: "c".repeat(64),
    }),
  );
  await ledger.observe(
    observed("POST", "/v1/content/package-exports", 409, {
      detail: { code: "package_stage_limit" },
    }),
  );
  await ledger.observe(
    observed("GET", `/v1/content/package-exports/${exportId}/file`, 200),
  );
  assert.deepEqual(ledger.open(), [
    { kind: "export", stageId: exportId },
    { kind: "import", stageId: importId },
  ]);

  await ledger.observe(
    observed("DELETE", `/v1/content/package-imports/${importId}`, 204),
  );
  // A 404 may be route drift rather than an absent stage, so the fixture's
  // own discard confirms it.
  await ledger.observe(
    observed("DELETE", `/v1/content/package-exports/${exportId}`, 404),
  );
  assert.deepEqual(ledger.open(), [{ kind: "export", stageId: exportId }]);
});

test("refuses a stage reply without one exact stage ID", async () => {
  const ledger = new PackageStageLedger();
  await assert.rejects(
    ledger.observe(
      observed("POST", "/v1/content/package-imports", 201, {
        stage_id: "../guessed",
      }),
    ),
    /exact stage ID/,
  );
  assert.deepEqual(ledger.open(), []);
});

test("releases open stages, waiting while a lease is still active", async () => {
  const calls = [];
  const replies = [
    { status: 409, code: "package_stage_active" },
    { status: 204, code: null },
    { status: 404, code: "package_stage_unavailable" },
  ];
  const waits = [];
  const outcome = await releasePackageStages(
    {
      discardPackageStage: async (kind, stageId) => {
        calls.push([kind, stageId]);
        return replies.shift();
      },
    },
    [
      { kind: "import", stageId: importId },
      { kind: "export", stageId: exportId },
    ],
    { wait: async (ms) => waits.push(ms) },
  );
  assert.deepEqual(calls, [
    ["import", importId],
    ["import", importId],
    ["export", exportId],
  ]);
  assert.equal(waits.length, 1);
  assert.deepEqual(outcome, {
    released: [
      { kind: "import", stageId: importId, outcome: "released" },
      { kind: "export", stageId: exportId, outcome: "absent" },
    ],
    held: [],
  });
});

test("reports stages that stay held or answer without the absent code", async () => {
  const calls = [];
  const proxied = "c".repeat(32);
  const outcome = await releasePackageStages(
    {
      discardPackageStage: async (kind, stageId) => {
        calls.push(stageId);
        if (stageId === importId)
          return { status: 409, code: "package_stage_active" };
        // A 404 from a proxy or a moved route is not proof of release.
        if (stageId === proxied) return { status: 404, code: null };
        return { status: 204, code: null };
      },
    },
    [
      { kind: "import", stageId: importId },
      { kind: "export", stageId: proxied },
      { kind: "export", stageId: exportId },
    ],
    { attempts: 3, wait: async () => undefined },
  );
  // A held stage does not stop the remaining stages from being released.
  assert.deepEqual(calls, [importId, importId, importId, proxied, exportId]);
  assert.deepEqual(outcome, {
    released: [{ kind: "export", stageId: exportId, outcome: "released" }],
    held: [
      {
        kind: "import",
        stageId: importId,
        status: 409,
        code: "package_stage_active",
      },
      { kind: "export", stageId: proxied, status: 404, code: null },
    ],
  });
});
