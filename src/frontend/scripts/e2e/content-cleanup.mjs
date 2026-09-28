import {
  appendContentLedgerEvent,
  readContentLedger,
  summarizeContentLedger,
  unresolvedOwnedContent,
} from "./content-ledger.mjs";
import { verifyLocalItemDirectoryAbsent } from "./local-content-verifier.mjs";
import { resolvePackageImportOwnership } from "./package-import-ownership.mjs";
import { stableJsonSha256 } from "./local-catalog-client.mjs";

/** Remove owned parents before supports; the API still rechecks every exact revision. */
async function cleanupOrder(states, client) {
  const pending = [];
  for (const state of states.filter((entry) => entry.owned.kind !== "anima")) {
    const current = await client.getItem(state.owned.itemId, {
      allowMissing: true,
    });
    pending.push({ state, dependencies: current?.dependencies ?? [] });
  }
  const ordered = states.filter((entry) => entry.owned.kind === "anima");
  while (pending.length) {
    const index = pending.findIndex(
      ({ state }) =>
        !pending.some(
          (other) =>
            other.state !== state &&
            other.dependencies.some((ref) =>
              [
                state.owned.logicalKey,
                state.owned.relativeLocator,
                state.owned.itemId,
              ].includes(ref),
            ),
        ),
    );
    if (index < 0)
      throw new Error(
        "Owned cleanup graph has cyclic dependencies; refusing deletion.",
      );
    ordered.push(pending.splice(index, 1)[0].state);
  }
  return ordered;
}

function commonFromOwned(owned) {
  return {
    runId: owned.runId,
    journeyKey: owned.journeyKey,
    kind: owned.kind,
    entryName: owned.entryName,
    logicalKey: owned.logicalKey,
    itemId: owned.itemId,
    revisionSha256: owned.revisionSha256,
  };
}

function cleanupMessage(error, localRoot, repositoryRoot) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secretPath of [localRoot, repositoryRoot]) {
    if (secretPath) message = message.split(secretPath).join("[LOCAL_PATH]");
  }
  return message.slice(0, 512) || "Unknown cleanup failure";
}

/** Delete only unresolved ledger-owned identities through the catalog API. */
export async function cleanupOwnedContent({
  ledgerPath,
  catalogClient,
  localRoot,
  repositoryRoot,
  actor,
}) {
  const initialEvents = await readContentLedger(ledgerPath);
  const results = [];
  const failures = [];
  const blockedOperations = new Set();
  const imports = summarizeContentLedger(initialEvents).filter(
    (state) => state.planned?.event === "import_planned" && !state.owned,
  );
  for (const state of imports) {
    try {
      await resolvePackageImportOwnership({
        ledgerPath,
        catalogClient,
        journeyKey: state.planned.journeyKey,
      });
    } catch (error) {
      blockedOperations.add(state.planned.operationId);
      failures.push({
        journeyKey: state.planned.journeyKey,
        code: "import_outcome_unconfirmed",
        message: cleanupMessage(error, localRoot, repositoryRoot),
      });
    }
  }
  const unresolved = unresolvedOwnedContent(
    await readContentLedger(ledgerPath),
  );

  for (const state of await cleanupOrder(unresolved, catalogClient)) {
    const owned = state.owned;
    const common = commonFromOwned(owned);
    try {
      if (blockedOperations.has(owned.operationId))
        throw new Error(
          "Imported Anima cleanup is unconfirmed; preserving its package content.",
        );
      if (state.last.event !== "cleanup_started") {
        await appendContentLedgerEvent(ledgerPath, {
          ...common,
          event: "cleanup_started",
          actor,
        });
      }
      if (owned.kind === "anima") {
        const current = await catalogClient.getAnima(owned.itemId, {
          allowMissing: true,
        });
        const avatar = await catalogClient.getAvatar(owned.relatedAvatarId, {
          allowMissing: true,
        });
        if (
          avatar &&
          (avatar.catalog_item_id !== owned.animaDefinition.avatar ||
            stableJsonSha256(avatar) !== owned.relatedAvatarSha256)
        )
          throw new Error("Imported private Avatar changed; refusing cleanup.");
        if (current) {
          const summary = await catalogClient.getAnimaExport(owned.itemId);
          if (
            !avatar ||
            current.id !== owned.itemId ||
            current.aggregate_revision !== 1 ||
            stableJsonSha256(summary.anima) !== owned.revisionSha256 ||
            stableJsonSha256(owned.animaDefinition) !== owned.revisionSha256
          )
            throw new Error(
              "Imported Anima definition changed; refusing cleanup.",
            );
          // This route has no compare-and-delete API. The named fixture's run
          // lock excludes other runners; an observed manual edit fails closed.
          const deleted = await catalogClient.deleteAnima(owned.itemId);
          if (
            deleted.status !== 204 ||
            (await catalogClient.getAnima(owned.itemId, { allowMissing: true }))
          )
            throw new Error("Exact imported Anima deletion was not confirmed.");
        }
        if (avatar) {
          const deleted = await catalogClient.deleteAvatar(
            owned.relatedAvatarId,
          );
          if (
            deleted.status !== 204 ||
            (await catalogClient.getAvatar(owned.relatedAvatarId, {
              allowMissing: true,
            }))
          )
            throw new Error(
              "Exact imported private Avatar deletion was not confirmed.",
            );
        }
        const outcome = current ? "deleted" : "already_missing";
        await appendContentLedgerEvent(ledgerPath, {
          ...common,
          event: "deleted",
          outcome,
        });
        results.push({
          journeyKey: owned.journeyKey,
          itemId: owned.itemId,
          revisionSha256: owned.revisionSha256,
          outcome,
        });
        continue;
      }
      const current = await catalogClient.getItem(owned.itemId, {
        allowMissing: true,
      });
      let outcome = "already_missing";
      if (current) {
        if (current.revision_sha256 !== owned.revisionSha256) {
          const error = new Error(
            "Owned catalog revision changed; refusing exact cleanup.",
          );
          error.code = "revision_conflict";
          throw error;
        }
        if (
          current.item_id !== owned.itemId ||
          current.source !== "local" ||
          current.origin !== "local" ||
          current.kind !== owned.kind ||
          current.logical_key !== owned.logicalKey ||
          current.relative_locator !== owned.relativeLocator
        ) {
          const error = new Error(
            "Owned catalog identity changed; refusing exact cleanup.",
          );
          error.code = "identity_conflict";
          throw error;
        }
        const deleted = await catalogClient.deleteItem(
          owned.itemId,
          owned.revisionSha256,
        );
        if (deleted.status !== 204) {
          const error = new Error(
            `Exact catalog DELETE returned HTTP ${deleted.status}.`,
          );
          error.code = "delete_http_error";
          throw error;
        }
        const after = await catalogClient.getItem(owned.itemId, {
          allowMissing: true,
        });
        if (after) {
          const error = new Error(
            "Exact catalog item remained readable after DELETE.",
          );
          error.code = "catalog_item_remaining";
          throw error;
        }
        outcome = "deleted";
      }
      await verifyLocalItemDirectoryAbsent({
        relativeLocator: owned.relativeLocator,
        localRoot,
        repositoryRoot,
      });
      await appendContentLedgerEvent(ledgerPath, {
        ...common,
        event: "deleted",
        outcome,
      });
      results.push({
        journeyKey: owned.journeyKey,
        itemId: owned.itemId,
        revisionSha256: owned.revisionSha256,
        outcome,
      });
    } catch (error) {
      if (owned.kind === "anima") blockedOperations.add(owned.operationId);
      const code =
        typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)
          ? error.code
          : "cleanup_failed";
      const message = cleanupMessage(error, localRoot, repositoryRoot);
      try {
        await appendContentLedgerEvent(ledgerPath, {
          ...common,
          event: "cleanup_failed",
          code,
          message,
        });
      } catch (ledgerError) {
        failures.push({
          journeyKey: owned.journeyKey,
          itemId: owned.itemId,
          code: "cleanup_ledger_failed",
          message: cleanupMessage(ledgerError, localRoot, repositoryRoot),
        });
        continue;
      }
      failures.push({
        journeyKey: owned.journeyKey,
        itemId: owned.itemId,
        code,
        message,
      });
    }
  }

  const summary = {
    attempted:
      unresolved.length +
      failures.filter(
        (failure) => failure.code === "import_outcome_unconfirmed",
      ).length,
    deleted: results.length,
    failed: failures.length,
    results,
    failures,
  };
  if (failures.length > 0) {
    const error = new Error(
      `Exact creator cleanup failed for ${failures.length} owned item(s).`,
    );
    error.summary = summary;
    throw error;
  }
  return summary;
}
