import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupDryRunEntries,
  parseCleanupArguments,
} from "./cleanup-command.mjs";

test("requires exact run confirmation for destructive cleanup", () => {
  assert.deepEqual(parseCleanupArguments(["run-0827123456"]), {
    runId: "run-0827123456",
    confirmed: false,
  });
  assert.deepEqual(
    parseCleanupArguments(["run-0827123456", "--confirm", "run-0827123456"]),
    { runId: "run-0827123456", confirmed: true },
  );
  assert.throws(
    () =>
      parseCleanupArguments(["run-0827123456", "--confirm", "run-0827123457"]),
    /exactly repeat/,
  );
  assert.throws(
    () => parseCleanupArguments(["all", "--confirm", "all"]),
    /exact generated run ID/,
  );
  assert.throws(
    () => parseCleanupArguments(["run-0827123456", "item-1"]),
    /Usage/,
  );
});

test("dry-run output omits names and filesystem locators", () => {
  const common = {
    schemaVersion: 1,
    timestamp: "2026-08-27T12:34:56.000Z",
    runId: "run-0827123456",
    journeyKey: "creator-reaction-expression-transition",
    kind: "reaction",
    entryName: "react-0827123456",
    logicalKey: "local:reaction:react-0827123456",
  };
  const entries = cleanupDryRunEntries([
    { ...common, event: "planned" },
    {
      ...common,
      event: "owned",
      itemId: "item-1",
      revisionSha256: "a".repeat(64),
      relativeLocator: "reactions/react-0827123456",
    },
  ]);
  assert.equal(entries.length, 1);
  assert.equal("relativeLocator" in entries[0], false);
  assert.equal("entryName" in entries[0], false);
});
