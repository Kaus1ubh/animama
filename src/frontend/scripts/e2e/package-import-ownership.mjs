import {
  appendContentLedgerEvent,
  readContentLedger,
  summarizeContentLedger,
  unresolvedOwnedContent,
} from "./content-ledger.mjs";
import {
  animaDefinitionSha256,
  stableJsonSha256,
} from "./local-catalog-client.mjs";

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
  // Each Reaction cell holds a pool of entry IDs, as each Idle cell does.
  for (const levels of Object.values(value.reactions)) {
    for (const [level, members] of Object.entries(levels))
      levels[level] = members.map(resolve);
  }
  value.idle.default = value.idle.default.map(resolve);
  for (const levels of Object.values(value.idle.cells)) {
    for (const [level, members] of Object.entries(levels))
      levels[level] = members.map(resolve);
  }
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
      animaDefinitionSha256(summary.anima) !==
        animaDefinitionSha256(animaDefinition) ||
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
      revisionSha256: animaDefinitionSha256(animaDefinition),
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

/**
 * Record a journey's own edit of an Anima it imported, so cleanup expects the
 * edited definition instead of refusing it as drift. `revise` derives the
 * expected definition from the last recorded one; the current Anima must
 * match it exactly at the aggregate revision the journey's own commit
 * reported, with its private Avatar unchanged.
 */
export async function recordOwnedAnimaRevision({
  ledgerPath,
  catalogClient,
  animaId,
  aggregateRevision,
  revise,
}) {
  const state = unresolvedOwnedContent(
    await readContentLedger(ledgerPath),
  ).find(
    (entry) => entry.owned.kind === "anima" && entry.owned.itemId === animaId,
  );
  if (!state)
    throw new Error("Only an Anima this run imported can record a revision.");
  const owned = state.owned;
  const expected = revise(structuredClone(owned.animaDefinition));
  const current = await catalogClient.getAnima(animaId);
  const summary = await catalogClient.getAnimaExport(animaId);
  const avatar = await catalogClient.getAvatar(owned.relatedAvatarId);
  if (
    current?.id !== animaId ||
    current.aggregate_revision !== aggregateRevision ||
    animaDefinitionSha256(summary.anima) !== animaDefinitionSha256(expected) ||
    avatar?.catalog_item_id !== expected.avatar ||
    stableJsonSha256(avatar) !== owned.relatedAvatarSha256
  )
    throw new Error(
      "Imported Anima does not match its expected revision; refusing to record it.",
    );
  return appendContentLedgerEvent(ledgerPath, {
    runId: owned.runId,
    journeyKey: owned.journeyKey,
    kind: owned.kind,
    entryName: owned.entryName,
    logicalKey: owned.logicalKey,
    event: "updated",
    itemId: animaId,
    revisionSha256: animaDefinitionSha256(expected),
    previousRevisionSha256: owned.revisionSha256,
    operationId: owned.operationId,
    aggregateRevision,
    animaDefinition: expected,
    relatedAvatarId: owned.relatedAvatarId,
    relatedAvatarSha256: owned.relatedAvatarSha256,
  });
}
