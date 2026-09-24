import {
  appendContentLedgerEvent,
  readContentLedger,
  summarizeContentLedger,
} from "./content-ledger.mjs";

/** Bind one reviewed test Pose only to its durable operation result and original revision. */
export async function resolvePackageImportOwnership({
  ledgerPath,
  catalogClient,
  journeyKey,
}) {
  const state = summarizeContentLedger(
    await readContentLedger(ledgerPath),
  ).find((entry) => entry.planned?.journeyKey === journeyKey);
  const planned = state?.planned;
  if (planned?.event !== "import_planned")
    throw new Error("Package import ownership has no recorded operation.");
  if (state.owned) return state.owned;
  const status = await catalogClient.getPackageOperation(planned.operationId);
  const result = status?.result;
  if (
    status?.operation_id !== planned.operationId ||
    status.state !== "completed" ||
    status.review_digest !== planned.reviewDigest ||
    result?.schema_version !== 1 ||
    result.operation_id !== planned.operationId ||
    result.review_digest !== planned.reviewDigest ||
    result.anima_id != null ||
    !Array.isArray(result.items) ||
    result.items.length !== 1
  ) {
    throw new Error(
      "Package import outcome is not confirmed by its exact reviewed receipt.",
    );
  }
  const imported = result.items[0];
  if (
    imported.entry_id !== planned.entryId ||
    imported.kind !== planned.kind ||
    imported.name !== planned.entryName ||
    imported.selected !== true ||
    typeof imported.logical_key !== "string" ||
    !imported.logical_key ||
    !/^[0-9a-f]{64}$/.test(imported.revision_sha256 ?? "")
  ) {
    throw new Error(
      "Package import receipt does not identify the planned entry and original revision.",
    );
  }
  const current = await catalogClient.getItem(imported.item_id);
  if (
    !current ||
    current.item_id !== imported.item_id ||
    current.source !== "local" ||
    current.origin !== "local" ||
    current.kind !== planned.kind ||
    current.logical_key !== imported.logical_key ||
    current.revision_sha256 !== imported.revision_sha256 ||
    typeof current.relative_locator !== "string"
  ) {
    throw new Error(
      "Imported content changed after commit; refusing cleanup ownership.",
    );
  }
  return appendContentLedgerEvent(ledgerPath, {
    ...planned,
    event: "import_owned",
    logicalKey: imported.logical_key,
    itemId: imported.item_id,
    revisionSha256: imported.revision_sha256,
    relativeLocator: current.relative_locator,
  });
}
