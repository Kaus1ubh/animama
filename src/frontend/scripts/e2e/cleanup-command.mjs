import { unresolvedContentWork } from "./content-ledger.mjs";

/** Accept only a named run and an optional identical confirmation token. */
export function parseCleanupArguments(argumentsList) {
  const args = argumentsList.filter((value) => value !== "--");
  if (args.length !== 1 && args.length !== 3) {
    throw new Error("Usage: pnpm e2e:cleanup -- <run-id> [--confirm <run-id>]");
  }
  const runId = args[0];
  if (!/^[a-z][a-z0-9-]*-\d{10}$/.test(runId)) {
    throw new Error("Cleanup requires one exact generated run ID.");
  }
  if (args.length === 3) {
    if (args[1] !== "--confirm" || args[2] !== runId) {
      throw new Error("Cleanup confirmation must exactly repeat the run ID.");
    }
  }
  return { runId, confirmed: args.length === 3 };
}

/** Present exact owned identities or unresolved operations, without names or host paths. */
export function cleanupDryRunEntries(events) {
  return unresolvedContentWork(events).map(({ owned, planned }) =>
    owned
      ? {
          journeyKey: owned.journeyKey,
          kind: owned.kind,
          logicalKey: owned.logicalKey,
          itemId: owned.itemId,
          revisionSha256: owned.revisionSha256,
        }
      : {
          journeyKey: planned.journeyKey,
          kind: planned.kind,
          operationId: planned.operationId,
          reviewDigest: planned.reviewDigest,
          state: "import_outcome_unconfirmed",
        },
  );
}
