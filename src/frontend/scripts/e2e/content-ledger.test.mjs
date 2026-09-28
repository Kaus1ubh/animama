import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendContentLedgerEvent,
  readContentLedger,
  unresolvedOwnedContent,
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

async function withLedger(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "animama-ledger-"));
  try {
    await run(path.join(directory, "content-ledger.jsonl"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("package planning gains cleanup authority only through exact receipt ownership", async () => {
  await withLedger(async (ledgerPath) => {
    const { logicalKey: _logicalKey, ...identity } = common;
    const planned = {
      ...identity,
      operationId: "import-operation",
      stageId: "a".repeat(32),
      reviewDigest: "b".repeat(64),
      entryId: "entry-0001",
      event: "import_planned",
    };
    await appendContentLedgerEvent(ledgerPath, planned);
    assert.equal(
      unresolvedOwnedContent(await readContentLedger(ledgerPath)).length,
      0,
    );
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, { ...owned, event: "owned" }),
      /import_planned -> owned/,
    );
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...planned,
        ...owned,
        event: "import_owned",
        reviewDigest: "c".repeat(64),
      }),
      /changed reviewDigest/,
    );
    await appendContentLedgerEvent(ledgerPath, {
      ...planned,
      ...owned,
      event: "import_owned",
    });
    const unresolved = unresolvedOwnedContent(
      await readContentLedger(ledgerPath),
    );
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].owned.itemId, "item-1");
  });
});

test("appends an immutable planned-to-deleted lifecycle", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "planned",
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...owned,
      event: "owned",
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "verified",
      itemId: owned.itemId,
      revisionSha256: owned.revisionSha256,
      fileCount: 2,
      manifestSha256: "b".repeat(64),
      files: [
        {
          relativePath: "reactions/react-0827123456/reaction.json",
          role: "descriptor",
          mediaType: "application/json",
          sizeBytes: 100,
          sha256: "c".repeat(64),
        },
        {
          relativePath: "reactions/react-0827123456/meta.json",
          role: "metadata",
          mediaType: "application/json",
          sizeBytes: 50,
          sha256: "d".repeat(64),
        },
      ],
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "cleanup_started",
      itemId: owned.itemId,
      revisionSha256: owned.revisionSha256,
      actor: "fixture",
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "deleted",
      itemId: owned.itemId,
      revisionSha256: owned.revisionSha256,
      outcome: "deleted",
    });

    const events = await readContentLedger(ledgerPath);
    assert.deepEqual(
      events.map((event) => event.event),
      ["planned", "owned", "verified", "cleanup_started", "deleted"],
    );
    assert.equal(unresolvedOwnedContent(events).length, 0);
    assert.equal(
      (await readFile(ledgerPath, "utf8")).trim().split("\n").length,
      5,
    );
  });
});

test("verified events require an exact bounded registered-file manifest", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "planned",
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...owned,
      event: "owned",
    });
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...common,
        event: "verified",
        itemId: owned.itemId,
        revisionSha256: owned.revisionSha256,
        fileCount: 1,
        manifestSha256: "b".repeat(64),
        files: [],
      }),
      /must match the bounded file count/,
    );
  });
});

test("planned names never become cleanup authority", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "planned",
    });
    assert.equal(
      unresolvedOwnedContent(await readContentLedger(ledgerPath)).length,
      0,
    );
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...common,
        event: "cleanup_started",
        itemId: "guessed-item",
        revisionSha256: "a".repeat(64),
        actor: "runner",
      }),
      /planned -> cleanup_started/,
    );
  });
});

test("rejects changed ownership identity and out-of-order transitions", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, {
      ...common,
      event: "planned",
    });
    await appendContentLedgerEvent(ledgerPath, {
      ...owned,
      event: "owned",
    });
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...common,
        event: "cleanup_started",
        itemId: owned.itemId,
        revisionSha256: "c".repeat(64),
        actor: "runner",
      }),
      /changed revisionSha256/,
    );
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...owned,
        event: "owned",
      }),
      /owned -> owned/,
    );
  });
});

test("rejects unknown fields and a truncated JSON line", async () => {
  await withLedger(async (ledgerPath) => {
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...common,
        event: "planned",
        arbitraryPath: "/tmp/delete-me",
      }),
      /unknown field arbitraryPath/,
    );
    const handle = await import("node:fs/promises").then(({ open }) =>
      open(ledgerPath, "a", 0o600),
    );
    await handle.writeFile('{"schemaVersion":1');
    await handle.close();
    await assert.rejects(readContentLedger(ledgerPath), /invalid JSON/);
  });
});

test("pose edits advance only an already owned identity from its exact recorded revision", async () => {
  await withLedger(async (ledgerPath) => {
    const plannedPose = {
      ...common,
      kind: "pose",
      logicalKey: "local:pose:fixture",
    };
    const original = {
      ...owned,
      ...plannedPose,
      relativeLocator: "poses/fixture",
    };
    await appendContentLedgerEvent(ledgerPath, {
      ...plannedPose,
      event: "planned",
    });
    await appendContentLedgerEvent(ledgerPath, { ...original, event: "owned" });
    const update = {
      ...original,
      event: "updated",
      previousRevisionSha256: original.revisionSha256,
      revisionSha256: "b".repeat(64),
    };
    for (const changes of [
      { previousRevisionSha256: "c".repeat(64) },
      { itemId: "not-owned" },
      { relativeLocator: "poses/not-owned" },
      { logicalKey: "local:pose:not-owned" },
    ]) {
      await assert.rejects(
        appendContentLedgerEvent(ledgerPath, { ...update, ...changes }),
      );
    }
    await appendContentLedgerEvent(ledgerPath, update);
    const state = unresolvedOwnedContent(
      await readContentLedger(ledgerPath),
    )[0];
    assert.equal(state.owned.itemId, original.itemId);
    assert.equal(state.owned.revisionSha256, update.revisionSha256);
    assert.equal(state.owned.relativeLocator, original.relativeLocator);
    assert.equal(
      (await readContentLedger(ledgerPath))[1].revisionSha256,
      original.revisionSha256,
    );
  });
});
