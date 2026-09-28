import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupOwnedContent } from "./content-cleanup.mjs";
import {
  appendContentLedgerEvent,
  readContentLedger,
} from "./content-ledger.mjs";

const common = {
  runId: "run-0827123456",
  journeyKey: "creator-reaction-expression-transition",
  kind: "reaction",
  entryName: "react-0827123456",
  logicalKey: "local:reaction:react-0827123456",
};
const owned = {
  ...common,
  itemId: "item-1",
  revisionSha256: "a".repeat(64),
  relativeLocator: "reactions/react-0827123456",
};
const importPlanned = {
  runId: common.runId,
  journeyKey: common.journeyKey,
  kind: common.kind,
  entryName: common.entryName,
  operationId: "import-operation",
  stageId: "a".repeat(32),
  reviewDigest: "b".repeat(64),
  entryId: "entry-0001",
};

function importReceipt() {
  return {
    operation_id: importPlanned.operationId,
    state: "completed",
    review_digest: importPlanned.reviewDigest,
    result: {
      schema_version: 1,
      operation_id: importPlanned.operationId,
      review_digest: importPlanned.reviewDigest,
      anima_id: null,
      items: [
        {
          entry_id: importPlanned.entryId,
          item_id: owned.itemId,
          kind: owned.kind,
          name: owned.entryName,
          logical_key: owned.logicalKey,
          revision_sha256: owned.revisionSha256,
          selected: true,
        },
      ],
    },
  };
}

async function setup({ withOwned = true, packageImport = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "animama-cleanup-"));
  const repositoryRoot = path.join(temporary, "repo");
  const localRoot = path.join(temporary, "isolated-stack", "local");
  const artifact = path.join(localRoot, ...owned.relativeLocator.split("/"));
  const ledgerPath = path.join(temporary, "content-ledger.jsonl");
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(artifact, { recursive: true });
  await appendContentLedgerEvent(
    ledgerPath,
    packageImport
      ? { ...importPlanned, event: "import_planned" }
      : { ...common, event: "planned" },
  );
  if (withOwned) {
    await appendContentLedgerEvent(ledgerPath, { ...owned, event: "owned" });
  }
  return { temporary, repositoryRoot, localRoot, artifact, ledgerPath };
}

test("lost import acknowledgment recovers only the matching receipt's exact revision", async () => {
  const value = await setup({ withOwned: false, packageImport: true });
  let present = true;
  const deleted = [];
  try {
    const summary = await cleanupOwnedContent({
      ...value,
      actor: "recovery",
      catalogClient: {
        getPackageOperation: async (id) => {
          assert.equal(id, importPlanned.operationId);
          return importReceipt();
        },
        getItem: async (id) => {
          assert.equal(id, owned.itemId);
          return present
            ? {
                item_id: owned.itemId,
                source: "local",
                origin: "local",
                kind: owned.kind,
                logical_key: owned.logicalKey,
                relative_locator: owned.relativeLocator,
                revision_sha256: owned.revisionSha256,
              }
            : null;
        },
        deleteItem: async (id, revision) => {
          deleted.push([id, revision]);
          present = false;
          await rm(value.artifact, { recursive: true });
          return { status: 204 };
        },
      },
    });
    assert.equal(summary.deleted, 1);
    assert.deepEqual(deleted, [[owned.itemId, owned.revisionSha256]]);
    assert.deepEqual(
      (await readContentLedger(value.ledgerPath)).map((event) => event.event),
      ["import_planned", "import_owned", "cleanup_started", "deleted"],
    );
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

for (const scenario of ["pending", "digest", "entry", "revision"]) {
  test(`unconfirmed import cleanup refuses ${scenario} and retains the operation journal`, async () => {
    const value = await setup({ withOwned: false, packageImport: true });
    const receipt = importReceipt();
    if (scenario === "pending") receipt.state = "pending";
    if (scenario === "digest") receipt.result.review_digest = "c".repeat(64);
    if (scenario === "entry")
      receipt.result.items[0].entry_id = "another-entry";
    let deleted = false;
    try {
      await assert.rejects(
        cleanupOwnedContent({
          ...value,
          actor: "recovery",
          catalogClient: {
            getPackageOperation: async () => receipt,
            getItem: async () => ({
              item_id: owned.itemId,
              source: "local",
              origin: "local",
              kind: owned.kind,
              logical_key: owned.logicalKey,
              relative_locator: owned.relativeLocator,
              revision_sha256: "c".repeat(64),
            }),
            deleteItem: async () => {
              deleted = true;
              return { status: 204 };
            },
          },
        }),
        /cleanup failed/,
      );
      assert.equal(deleted, false);
      assert.equal(
        (await readContentLedger(value.ledgerPath)).at(-1).event,
        "import_planned",
      );
    } finally {
      await rm(value.temporary, { recursive: true, force: true });
    }
  });
}

test("deletes one exact matching identity and proves its artifact absent", async () => {
  const value = await setup();
  try {
    let present = true;
    const deleted = [];
    const client = {
      getItem: async () =>
        present
          ? {
              item_id: owned.itemId,
              source: "local",
              origin: "local",
              kind: owned.kind,
              logical_key: owned.logicalKey,
              relative_locator: owned.relativeLocator,
              revision_sha256: owned.revisionSha256,
            }
          : null,
      deleteItem: async (itemId, revision) => {
        deleted.push([itemId, revision]);
        present = false;
        await rm(value.artifact, { recursive: true });
        return { status: 204 };
      },
    };
    const summary = await cleanupOwnedContent({
      ledgerPath: value.ledgerPath,
      catalogClient: client,
      localRoot: value.localRoot,
      repositoryRoot: value.repositoryRoot,
      actor: "runner",
    });
    assert.equal(summary.deleted, 1);
    assert.deepEqual(deleted, [[owned.itemId, owned.revisionSha256]]);
    assert.equal(
      (await readContentLedger(value.ledgerPath)).at(-1).event,
      "deleted",
    );
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

test("refuses a changed revision and records cleanup failure", async () => {
  const value = await setup();
  try {
    let deleteCalled = false;
    await assert.rejects(
      cleanupOwnedContent({
        ledgerPath: value.ledgerPath,
        catalogClient: {
          getItem: async () => ({ revision_sha256: "b".repeat(64) }),
          deleteItem: async () => {
            deleteCalled = true;
            return { status: 204 };
          },
        },
        localRoot: value.localRoot,
        repositoryRoot: value.repositoryRoot,
        actor: "recovery",
      }),
      /failed for 1 owned item/,
    );
    assert.equal(deleteCalled, false);
    const events = await readContentLedger(value.ledgerPath);
    assert.deepEqual(
      events.slice(-2).map((event) => event.event),
      ["cleanup_started", "cleanup_failed"],
    );
    assert.equal(events.at(-1).code, "revision_conflict");
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

test("refuses a changed catalog locator even at the owned revision", async () => {
  const value = await setup();
  try {
    let deleteCalled = false;
    await assert.rejects(
      cleanupOwnedContent({
        ledgerPath: value.ledgerPath,
        catalogClient: {
          getItem: async () => ({
            item_id: owned.itemId,
            source: "local",
            origin: "local",
            kind: owned.kind,
            logical_key: owned.logicalKey,
            relative_locator: "reactions/not-the-owned-item",
            revision_sha256: owned.revisionSha256,
          }),
          deleteItem: async () => {
            deleteCalled = true;
            return { status: 204 };
          },
        },
        localRoot: value.localRoot,
        repositoryRoot: value.repositoryRoot,
        actor: "recovery",
      }),
      /failed for 1 owned item/,
    );
    assert.equal(deleteCalled, false);
    assert.equal(
      (await readContentLedger(value.ledgerPath)).at(-1).code,
      "identity_conflict",
    );
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

test("never treats a planned-only name as deletion authority", async () => {
  const value = await setup({ withOwned: false });
  try {
    let called = false;
    const summary = await cleanupOwnedContent({
      ledgerPath: value.ledgerPath,
      catalogClient: {
        getItem: async () => {
          called = true;
        },
      },
      localRoot: value.localRoot,
      repositoryRoot: value.repositoryRoot,
      actor: "runner",
    });
    assert.equal(summary.attempted, 0);
    assert.equal(called, false);
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

test("marks an already-missing exact item only after host absence proof", async () => {
  const value = await setup();
  try {
    await rm(value.artifact, { recursive: true });
    const summary = await cleanupOwnedContent({
      ledgerPath: value.ledgerPath,
      catalogClient: {
        getItem: async () => null,
      },
      localRoot: value.localRoot,
      repositoryRoot: value.repositoryRoot,
      actor: "recovery",
    });
    assert.equal(summary.results[0].outcome, "already_missing");
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});

test("cleans only the latest explicitly recorded revision after an owned edit", async () => {
  const value = await setup();
  try {
    const revision = "b".repeat(64);
    await appendContentLedgerEvent(value.ledgerPath, {
      ...owned,
      event: "updated",
      previousRevisionSha256: owned.revisionSha256,
      revisionSha256: revision,
    });
    let present = true;
    const deleted = [];
    const summary = await cleanupOwnedContent({
      ledgerPath: value.ledgerPath,
      catalogClient: {
        getItem: async () =>
          present
            ? {
                item_id: owned.itemId,
                source: "local",
                origin: "local",
                kind: owned.kind,
                logical_key: owned.logicalKey,
                relative_locator: owned.relativeLocator,
                revision_sha256: revision,
              }
            : null,
        deleteItem: async (itemId, expectedRevision) => {
          deleted.push([itemId, expectedRevision]);
          present = false;
          await rm(value.artifact, { recursive: true });
          return { status: 204 };
        },
      },
      localRoot: value.localRoot,
      repositoryRoot: value.repositoryRoot,
      actor: "fixture",
    });
    assert.equal(summary.deleted, 1);
    assert.deepEqual(deleted, [[owned.itemId, revision]]);
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
});
