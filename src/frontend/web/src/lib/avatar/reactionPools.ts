/**
 * Reaction cells and pools.
 *
 * Each tracked emotion has one Reaction cell per Reaction intensity, and each
 * cell holds a pool of up to four Reactions. Chat picks one member of the
 * event's cell at random; Idle keeps its own three intensities.
 *
 * This module has no content imports so interface code can share it.
 */
import {
  TRACKED_EMOTIONS,
  isTrackedEmotion,
  type TrackedEmotion,
} from "@/lib/emotion";

/** Reaction intensities from Mild (1) to Intense (4). */
export const REACTION_INTENSITIES = [1, 2, 3, 4] as const;
export type EmotionReactionIntensity = (typeof REACTION_INTENSITIES)[number];

/** The most Reactions one cell's pool may hold. */
export const REACTION_POOL_LIMIT = 4;

/** Reaction pools as emotion → intensity ("1"–"4") → runtime ids. */
export type ReactionPools = Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

/** The cell an Included Reaction's id names. */
export type IncludedReactionCell = {
  emotion: TrackedEmotion;
  intensity: EmotionReactionIntensity;
  /** `null` for the cell's first Reaction, `"b"` for its second. */
  variant: "b" | null;
};

/**
 * Read the cell from an Included Reaction id: `<emotion>-<intensity>` is the
 * cell's first Reaction and `<emotion>-<intensity>-b` its second, as in
 * `joy-4` and `joy-4-b`. Any other id names no cell.
 */
export function parseIncludedReactionId(
  id: string,
): IncludedReactionCell | null {
  const match = /^([a-z_]+)-(\d)(-b)?$/.exec(id);
  if (!match || !isTrackedEmotion(match[1])) return null;
  const intensity = REACTION_INTENSITIES.find(
    (level) => level === Number(match[2]),
  );
  if (!intensity) return null;
  return { emotion: match[1], intensity, variant: match[3] ? "b" : null };
}

/**
 * Group Included Reaction ids into the pools their ids name, as the starter
 * policy fills them: each cell holds all of its Included Reactions, the first
 * before the second. Every tracked emotion has an entry; a cell without a
 * Reaction is left out, and ids that name no cell are ignored.
 */
export function groupIncludedReactionPools(
  ids: readonly string[],
): ReactionPools {
  const cells = ids.flatMap((id) => {
    const cell = parseIncludedReactionId(id);
    return cell ? [{ ...cell, id }] : [];
  });
  const pool = (emotion: TrackedEmotion, intensity: EmotionReactionIntensity) =>
    cells
      .filter(
        (cell) => cell.emotion === emotion && cell.intensity === intensity,
      )
      .sort((left, right) =>
        (left.variant ?? "").localeCompare(right.variant ?? ""),
      )
      .map((cell) => cell.id);
  return Object.freeze(
    Object.fromEntries(
      TRACKED_EMOTIONS.map((emotion) => [
        emotion,
        Object.freeze(
          Object.fromEntries(
            REACTION_INTENSITIES.flatMap((intensity) => {
              const members = pool(emotion, intensity);
              return members.length
                ? [[String(intensity), Object.freeze(members)]]
                : [];
            }),
          ),
        ),
      ]),
    ),
  );
}

/**
 * Pick one member of a Reaction pool from a random roll in [0, 1).
 *
 * The choice is uniform. With two or more members it never repeats
 * `previous` (the cell's last pick), so a one-member pool always plays its
 * member and an empty pool plays nothing.
 */
export function pickReactionPoolMember(
  members: readonly string[],
  randomRoll: number,
  previous?: string | null,
): string | null {
  const unique = [...new Set(members)];
  const fresh =
    previous && unique.length > 1
      ? unique.filter((member) => member !== previous)
      : unique;
  if (!fresh.length) return null;
  const roll = Number.isFinite(randomRoll)
    ? Math.min(Math.max(randomRoll, 0), 1)
    : 0;
  // A roll of exactly 1 still lands on the last member.
  return fresh[Math.min(fresh.length - 1, Math.floor(roll * fresh.length))]!;
}
