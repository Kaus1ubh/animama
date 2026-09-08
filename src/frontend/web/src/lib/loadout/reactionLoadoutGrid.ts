import type { PyReactionCell } from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";

export type ReactionLoadoutRow = {
  emotion: TrackedEmotion;
  cells: [PyReactionCell, PyReactionCell, PyReactionCell];
};

export type ReactionSelectorGroups = {
  local: PyReaction[];
  included: PyReaction[];
};

/** Group every ready Reaction without constraining it to the target cell. */
export function groupReactionSelectorChoices(
  available: PyReaction[],
): ReactionSelectorGroups {
  return {
    local: available.filter((reaction) => reaction.origin === "owned"),
    included: available.filter((reaction) => reaction.origin === "builtin"),
  };
}

function emptyCell(emotion: TrackedEmotion, intensity: number) {
  return { emotion, intensity, state: "empty" as const };
}

/** Build the fixed 24-by-3 Reaction matrix, ordered alphabetically by emotion. */
export function buildReactionLoadoutGrid(
  cells: readonly PyReactionCell[],
): ReactionLoadoutRow[] {
  const byCell = new Map(
    cells.map((cell) => [`${cell.emotion}:${cell.intensity}`, cell]),
  );
  return [...TRACKED_EMOTIONS]
    .sort((left, right) => left.localeCompare(right))
    .map((emotion) => ({
      emotion,
      cells: [1, 2, 3].map(
        (intensity) =>
          byCell.get(`${emotion}:${intensity}`) ??
          emptyCell(emotion, intensity),
      ) as ReactionLoadoutRow["cells"],
    }));
}
