import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("an imported Anima's revision keeps its import and Avatar and advances its aggregate revision", async () => {
  await withLedger(async (ledgerPath) => {
    const identity = {
      runId: common.runId,
      journeyKey: "sharing-anima-0",
      kind: "anima",
      entryName: "Annie-2",
    };
    const definition = { display_name: "Annie-2", avatar: "avatar-copy" };
    const planned = {
      ...identity,
      operationId: "import-operation",
      stageId: "a".repeat(32),
      reviewDigest: "b".repeat(64),
      entryId: "anima",
      packageEntries: [
        { entryId: "avatar", kind: "avatar", name: "Annie-2", selected: true },
      ],
      packageAnima: definition,
      event: "import_planned",
    };
    const imported = {
      ...planned,
      event: "import_owned",
      logicalKey: "package-anima:import-operation",
      itemId: "anima-copy",
      revisionSha256: "c".repeat(64),
      animaDefinition: definition,
      relatedAvatarId: "logical-avatar",
      relatedAvatarSha256: "d".repeat(64),
    };
    await appendContentLedgerEvent(ledgerPath, planned);
    await appendContentLedgerEvent(ledgerPath, imported);
    const revision = {
      ...identity,
      event: "updated",
      logicalKey: imported.logicalKey,
      itemId: imported.itemId,
      revisionSha256: "e".repeat(64),
      previousRevisionSha256: imported.revisionSha256,
      operationId: imported.operationId,
      aggregateRevision: 2,
      animaDefinition: { ...definition, display_name: "Edited" },
      relatedAvatarId: imported.relatedAvatarId,
      relatedAvatarSha256: imported.relatedAvatarSha256,
    };
    for (const changes of [
      { aggregateRevision: 1 },
      { operationId: "other-operation" },
      { relatedAvatarId: "other-avatar" },
      { relatedAvatarSha256: "f".repeat(64) },
      { animaDefinition: undefined },
    ])
      await assert.rejects(
        appendContentLedgerEvent(ledgerPath, { ...revision, ...changes }),
      );
    await appendContentLedgerEvent(ledgerPath, revision);
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...revision,
        previousRevisionSha256: revision.revisionSha256,
        revisionSha256: "f".repeat(64),
      }),
      /aggregate revision/,
    );
    const [state] = unresolvedOwnedContent(await readContentLedger(ledgerPath));
    assert.equal(state.owned.aggregateRevision, 2);
    assert.equal(state.owned.operationId, imported.operationId);
    assert.equal(state.owned.animaDefinition.display_name, "Edited");
  });
});

test("only an Anima's revision may record an Anima definition", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, { ...common, event: "planned" });
    await appendContentLedgerEvent(ledgerPath, { ...owned, event: "owned" });
    await assert.rejects(
      appendContentLedgerEvent(ledgerPath, {
        ...owned,
        event: "updated",
        previousRevisionSha256: owned.revisionSha256,
        revisionSha256: "b".repeat(64),
        aggregateRevision: 2,
      }),
      /Only an Anima revision/,
    );
  });
});

test("rereads validate appended lines and revalidate a changed ledger", async () => {
  await withLedger(async (ledgerPath) => {
    await appendContentLedgerEvent(ledgerPath, { ...common, event: "planned" });
    await appendContentLedgerEvent(ledgerPath, { ...owned, event: "owned" });
    const [planned] = await readContentLedger(ledgerPath);
    assert.throws(() => {
      planned.journeyKey = "changed";
    }, TypeError);
    const source = await readFile(ledgerPath, "utf8");
    // A line another writer appends is validated against the cached events.
    await writeFile(ledgerPath, `${source}${source.split("\n")[0]}\n`);
    await assert.rejects(readContentLedger(ledgerPath), /owned -> planned/);
    // An edited earlier line invalidates the cached events.
    await writeFile(ledgerPath, source.replace(common.runId, "run-0827123457"));
    await assert.rejects(readContentLedger(ledgerPath), /changed runId/);
    await writeFile(ledgerPath, source);
    assert.equal((await readContentLedger(ledgerPath)).length, 2);
  });
});
