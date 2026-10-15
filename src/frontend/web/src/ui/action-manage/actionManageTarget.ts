import type {
  PyAnimaLoadout,
  PyCatalogLoadoutSource,
  PyReactionCell,
  PyReactionMember,
} from "@animama/runtime-contracts/api-types";
import { REACTION_INTENSITIES } from "@/lib/avatar/reactionPools";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { reactionCellFull } from "@/lib/loadout/reactionLoadoutGrid";
import type { ManageActionTarget } from "./ActionManageDialog";

/** One Reaction cell: a tracked emotion and an intensity from 1 to 4. */
export type ReactionCellKey = Pick<PyReactionCell, "emotion" | "intensity">;

/** Loadout `add` intents require the item's library partition. */
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
 * The cell the equip dialog starts on: the Reaction's suggested cell, or Joy,
 * Mild when it suggests none. A suggestion without a usable intensity starts
 * at Mild for its emotion.
 */
export function actionManageReactionCell(
  target: Pick<ManageActionTarget, "emotion" | "intensity">,
): ReactionCellKey {
  const emotion = (TRACKED_EMOTIONS as readonly string[]).find(
    (candidate) => candidate === target.emotion,
  );
  if (!emotion) return { emotion: "joy", intensity: 1 };
  const intensity = REACTION_INTENSITIES.find(
    (level) => level === target.intensity,
  );
  return { emotion, intensity: intensity ?? 1 };
}

/** One Anima's cell, or `null` when the Loadout lists no such cell. */
function loadoutReactionCell(
  loadout: PyAnimaLoadout,
  cell: ReactionCellKey,
): PyReactionCell | null {
  return (
    loadout.reactions.find(
      (candidate) =>
        candidate.emotion === cell.emotion &&
        candidate.intensity === cell.intensity,
    ) ?? null
  );
}

/** The target's member in one cell's pool on one Anima, if it is there. */
export function actionManageReactionMember(
  target: Pick<ManageActionTarget, "itemId">,
  loadout: PyAnimaLoadout,
  cell: ReactionCellKey,
): PyReactionMember | null {
  return (
    loadoutReactionCell(loadout, cell)?.members?.find(
      (member) => member.item_id === target.itemId,
    ) ?? null
  );
}

/** How an item stands in one Anima's Loadout. */
export type ActionManageRowState = {
  /** A Gesture binding uses the item, or the chosen Reaction cell holds it. */
  equipped: boolean;
  /** Adding a Gesture would replace another with its semantic key. */
  replacing: boolean;
  /** The chosen Reaction cell holds four Reactions, so none can be added. */
  full: boolean;
};

/**
 * Equip state of a target in one Anima's loadout.
 *
 * A Gesture is equipped when any binding uses its catalog item; Gesture slots
 * are keyed by semantic key, so a different item with the same key would be
 * replaced. A Reaction is equipped when the chosen cell's pool (by default its
 * suggested cell) holds it; adding it never replaces another member, but a
 * full pool takes no more.
 */
export function actionManageRowState(
  target: ManageActionTarget,
  loadout: PyAnimaLoadout,
  cell: ReactionCellKey = actionManageReactionCell(target),
): ActionManageRowState {
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
    return { equipped, replacing, full: false };
  }
  return {
    equipped: actionManageReactionMember(target, loadout, cell) !== null,
    replacing: false,
    full: reactionCellFull(loadoutReactionCell(loadout, cell) ?? {}),
  };
}
