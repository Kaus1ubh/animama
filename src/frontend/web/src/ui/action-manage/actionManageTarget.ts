import type {
  PyAnimaLoadout,
  PyCatalogLoadoutSource,
} from "@animama/runtime-contracts/api-types";
import type { ManageActionTarget } from "./ActionManageDialog";

/** Loadout `add`/`replace` intents require the item's library partition. */
export function actionManageLoadoutSource(
  target: ManageActionTarget,
): PyCatalogLoadoutSource | null {
  const source = target.source;
  if (source?.type !== "catalog" || !source.source) return null;
  return {
    type: "catalog",
    catalog_item_id: source.catalog_item_id,
    logical_key: source.logical_key,
    source: source.source,
  };
}

/**
 * Equip state of a target in one Anima's loadout.
 *
 * A Gesture is equipped when any binding uses its catalog item; Gesture slots
 * are keyed by semantic key, so a different item with the same key would be
 * replaced. A Reaction occupies one emotion/intensity cell.
 */
export function actionManageRowState(
  target: ManageActionTarget,
  loadout: PyAnimaLoadout,
): { equipped: boolean; replacing: boolean } {
  if (target.kind === "gesture") {
    const equipped = loadout.gestures.some(
      (binding) => binding.source.catalog_item_id === target.itemId,
    );
    const replacing =
      !equipped &&
      Boolean(target.semanticKey) &&
      loadout.gestures.some(
        (binding) => binding.semantic_key === target.semanticKey,
      );
    return { equipped, replacing };
  }
  const cell = loadout.reactions.find(
    (candidate) =>
      candidate.emotion === (target.emotion ?? "joy") &&
      candidate.intensity === (target.intensity ?? 1),
  );
  const equipped = cell?.source?.catalog_item_id === target.itemId;
  return { equipped, replacing: Boolean(cell && !equipped) };
}
