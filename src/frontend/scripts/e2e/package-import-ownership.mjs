import {
  appendContentLedgerEvent,
  readContentLedger,
  summarizeContentLedger,
} from "./content-ledger.mjs";
import { stableJsonSha256 } from "./local-catalog-client.mjs";

/** Rewrite only the portable definition's declared content-reference fields. */
function installedDefinition(definition, items) {
  const value = structuredClone(definition);
  const references = new Map(
    items.map((item) => [item.entry_id, item.item_id]),
  );
  const resolve = (id) => {
    if (!references.has(id))
      throw new Error("Anima receipt omitted reviewed content.");
    return references.get(id);
  };
  value.avatar = resolve(value.avatar);
  for (const gesture of value.gestures)
    gesture.entry_id = resolve(gesture.entry_id);
  for (const cells of Object.values(value.reactions)) {
    for (const selection of Object.values(cells)) {
      if (selection) selection.entry_id = resolve(selection.entry_id);
    }
  }
  if (value.idle_style) value.idle_style = resolve(value.idle_style);
  for (const selection of Object.values(value.appearance)) {
    if (selection) selection.entry_id = resolve(selection.entry_id);
  }
  return value;
}

/** Bind reviewed entries only to their durable operation result and original revisions. */
export async function resolvePackageImportOwnership({
  ledgerPath,
  catalogClient,
  journeyKey,
}) {
  const states = summarizeContentLedger(await readContentLedger(ledgerPath));
  const state = states.find(
    (entry) => entry.planned?.journeyKey === journeyKey,
  );
  const planned = state?.planned;
  if (planned?.event !== "import_planned")
    throw new Error("Package import ownership has no recorded operation.");
  if (state.owned) return state.owned;
  const status = await catalogClient.getPackageOperation(planned.operationId);
  const result = status?.result;
  const expectedEntries = planned.packageEntries ?? [
    {
      entryId: planned.entryId,
      kind: planned.kind,
      name: planned.entryName,
      selected: true,
    },
  ];
  const groupedPlans = states.filter(
    (entry) => entry.planned?.operationId === planned.operationId,
  );
  if (
    status?.operation_id !== planned.operationId ||
    status.state !== "completed" ||
    status.review_digest !== planned.reviewDigest ||
    result?.schema_version !== 1 ||
    result.operation_id !== planned.operationId ||
    result.review_digest !== planned.reviewDigest ||
    (planned.packageAnima
      ? typeof result.anima_id !== "string" || !result.anima_id
      : result.anima_id != null) ||
    !Array.isArray(result.items) ||
    result.items.length !== expectedEntries.length ||
    groupedPlans.length !==
      expectedEntries.length + (planned.packageAnima ? 1 : 0) ||
    new Set(result.items.map((item) => item.entry_id)).size !==
      result.items.length ||
    new Set(result.items.map((item) => item.item_id)).size !==
      result.items.length ||
    result.items.some(
      (item) =>
        !expectedEntries.some(
          (entry) =>
            item.entry_id === entry.entryId &&
            item.kind === entry.kind &&
            item.name === entry.name &&
            item.selected === entry.selected &&
            typeof item.logical_key === "string" &&
            item.logical_key &&
            /^[0-9a-f]{64}$/.test(item.revision_sha256 ?? ""),
        ),
    )
  ) {
    throw new Error(
      "Package import outcome is not confirmed by its exact reviewed receipt.",
    );
  }
  if (planned.kind === "anima") {
    const animaDefinition = installedDefinition(
      planned.packageAnima,
      result.items,
    );
    const current = await catalogClient.getAnima(result.anima_id);
    const summary = await catalogClient.getAnimaExport(result.anima_id);
    const avatarItem = result.items.find(
      (item) => item.item_id === animaDefinition.avatar,
    );
    const avatar = current?.avatar;
    if (
      !current ||
      current.id !== result.anima_id ||
      current.aggregate_revision !== 1 ||
      stableJsonSha256(summary.anima) !== stableJsonSha256(animaDefinition) ||
      !avatar ||
      avatar.catalog_item_id !== animaDefinition.avatar ||
      avatar.private !== true ||
      avatar.identity !== "" ||
      avatar.model_type !== "vrm" ||
      avatar.animation_profile != null ||
      avatar.presentation_revision !== 1 ||
      ![avatarItem?.name, `${avatarItem?.name} (${avatar.id})`].includes(
        avatar.name,
      )
    )
      throw new Error(
        "Imported Anima or its private Avatar changed; refusing cleanup ownership.",
      );
    return appendContentLedgerEvent(ledgerPath, {
      ...planned,
      event: "import_owned",
      itemId: result.anima_id,
      logicalKey: `package-anima:${planned.operationId}`,
      revisionSha256: stableJsonSha256(animaDefinition),
      animaDefinition,
      relatedAvatarId: avatar.id,
      relatedAvatarSha256: stableJsonSha256(avatar),
    });
  }
  const imported = result.items.find(
    (item) => item.entry_id === planned.entryId,
  );
  if (
    imported.entry_id !== planned.entryId ||
    imported.kind !== planned.kind ||
    imported.name !== planned.entryName ||
    imported.selected !==
      expectedEntries.find((entry) => entry.entryId === planned.entryId)
        ?.selected ||
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
