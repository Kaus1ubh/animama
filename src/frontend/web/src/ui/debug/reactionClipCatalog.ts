import type { ReactionPools } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  REACTION_INTENSITIES,
  type EmotionReactionIntensity,
} from "@/lib/avatar/reactionPools";
import {
  groupForEmotion,
  isTrackedEmotion,
  type EmotionGroup,
  type TrackedEmotion,
} from "@/lib/emotion";

/** One Reaction cell whose pool holds a clip. */
export type ReactionClipCell = {
  emotion: TrackedEmotion;
  group: EmotionGroup;
  intensity: EmotionReactionIntensity;
};

/** The debug catalog's filters; `"all"` leaves a dimension open. */
export type ReactionClipFilters = {
  group: EmotionGroup | "all";
  emotion: TrackedEmotion | "all";
  intensity: `${EmotionReactionIntensity}` | "all";
};

/**
 * The cells each runtime id plays in, read from the catalog's pools. A
 * Reaction can sit in several cells; one in no pool has no entry.
 */
export function reactionClipCells(
  pools: ReactionPools,
): Map<string, ReactionClipCell[]> {
  const cells = new Map<string, ReactionClipCell[]>();
  for (const [emotion, levels] of Object.entries(pools)) {
    if (!isTrackedEmotion(emotion)) continue;
    const group = groupForEmotion(emotion);
    if (!group) continue;
    for (const intensity of REACTION_INTENSITIES)
      for (const runtimeId of levels[String(intensity)] ?? [])
        cells.set(runtimeId, [
          ...(cells.get(runtimeId) ?? []),
          { emotion, group, intensity },
        ]);
  }
  return cells;
}

/**
 * Whether a clip passes the filters: one of its cells must pass all of them.
 * A clip in no cell shows only while every filter is open.
 */
export function reactionClipMatchesFilters(
  cells: readonly ReactionClipCell[],
  filters: ReactionClipFilters,
): boolean {
  if (
    filters.group === "all" &&
    filters.emotion === "all" &&
    filters.intensity === "all"
  )
    return true;
  return cells.some(
    (cell) =>
      (filters.group === "all" || cell.group === filters.group) &&
      (filters.emotion === "all" || cell.emotion === filters.emotion) &&
      (filters.intensity === "all" ||
        `${cell.intensity}` === filters.intensity),
  );
}

/** A clip's cells for the debug table, such as `joy 2, sadness 4`. */
export function formatReactionClipCells(
  cells: readonly ReactionClipCell[],
): string {
  return cells.length
    ? cells.map((cell) => `${cell.emotion} ${cell.intensity}`).join(", ")
    : "-";
}
