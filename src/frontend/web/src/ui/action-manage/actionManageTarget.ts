import type {
  PyAnimaLoadout,
  PyCatalogLoadoutSource,
  PyReactionCell,
  PyReactionMember,
} from "@animama/runtime-contracts/api-types";
import { REACTION_INTENSITIES } from "@/lib/avatar/reactionPools";
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
 * The Reaction cell the dialog edits: the Reaction's suggested cell, or Joy,
 * Mild when it suggests none.
 */
export function actionManageReactionCell(
  target: Pick<ManageActionTarget, "emotion" | "intensity">,
): Pick<PyReactionCell, "emotion" | "intensity"> {
  const intensity = REACTION_INTENSITIES.find(
    (level) => level === target.intensity,
  );
  return { emotion: target.emotion ?? "joy", intensity: intensity ?? 1 };
}

/** The target's member in its cell's pool on one Anima, if it is there. */
export function actionManageReactionMember(
  target: ManageActionTarget,
  loadout: PyAnimaLoadout,
): PyReactionMember | null {
  const { emotion, intensity } = actionManageReactionCell(target);
  const cell = loadout.reactions.find(
    (candidate) =>
      candidate.emotion === emotion && candidate.intensity === intensity,
  );
  return (
    cell?.members?.find((member) => member.item_id === target.itemId) ?? null
  );
}

/**
 * Equip state of a target in one Anima's loadout.
 *
 * A Gesture is equipped when any binding uses its catalog item; Gesture slots
 * are keyed by semantic key, so a different item with the same key would be
 * replaced. A Reaction is equipped when its cell's pool holds it; adding it
 * never replaces another member.
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
  return {
    equipped: actionManageReactionMember(target, loadout) !== null,
    replacing: false,
  };
}
