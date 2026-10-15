import type {
  PyCatalogLoadoutSource,
  PyReactionCell,
  PyReactionIntent,
} from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import {
  REACTION_INTENSITIES,
  REACTION_POOL_LIMIT,
} from "@/lib/avatar/reactionPools";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";

export type ReactionLoadoutRow = {
  emotion: TrackedEmotion;
  /** The emotion's cells from Mild (1) to Intense (4). */
  cells: [PyReactionCell, PyReactionCell, PyReactionCell, PyReactionCell];
  /** Reactions across the emotion's four cells, for the collapsed summary. */
  reactionCount: number;
};

export type ReactionSelectorGroups<Item = PyReaction> = {
  local: Item[];
  included: Item[];
};

/** Group every ready Reaction without constraining it to the target cell. */
export function groupReactionSelectorChoices<
  Item extends { origin: "owned" | "builtin" } = PyReaction,
>(available: readonly Item[]): ReactionSelectorGroups<Item> {
  return {
    local: available.filter((reaction) => reaction.origin === "owned"),
    included: available.filter((reaction) => reaction.origin === "builtin"),
  };
}

function emptyCell(
  emotion: TrackedEmotion,
  intensity: PyReactionCell["intensity"],
): PyReactionCell {
  return { emotion, intensity, state: "empty", members: [] };
}

/** Build the fixed 24-by-4 Reaction matrix, ordered alphabetically by emotion. */
export function buildReactionLoadoutGrid(
  cells: readonly PyReactionCell[],
): ReactionLoadoutRow[] {
  const byCell = new Map(
    cells.map((cell) => [`${cell.emotion}:${cell.intensity}`, cell]),
  );
  return [...TRACKED_EMOTIONS]
    .sort((left, right) => left.localeCompare(right))
    .map((emotion) => {
      const rowCells = REACTION_INTENSITIES.map(
        (intensity) =>
          byCell.get(`${emotion}:${intensity}`) ??
          emptyCell(emotion, intensity),
      ) as ReactionLoadoutRow["cells"];
      return {
        emotion,
        cells: rowCells,
        reactionCount: rowCells.reduce(
          (count, cell) => count + (cell.members?.length ?? 0),
          0,
        ),
      };
    });
}

/** Whether a cell's pool already holds the most Reactions a cell may hold. */
export function reactionCellFull(cell: {
  members?: readonly unknown[] | null;
}): boolean {
  return (cell.members?.length ?? 0) >= REACTION_POOL_LIMIT;
}

/** The intent adding a Reaction to one cell's pool. */
export function reactionAddIntent(
  cell: Pick<PyReactionCell, "emotion" | "intensity">,
  source: PyCatalogLoadoutSource,
): PyReactionIntent {
  return {
    operation: "add",
    emotion: cell.emotion,
    intensity: cell.intensity,
    source,
  };
}
