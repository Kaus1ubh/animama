/**
 * Reaction cells and pools.
 *
 * Each tracked emotion has one Reaction cell per Reaction intensity, and each
 * cell holds a pool of up to four Reactions. Chat picks one member of the
 * event's cell at random; Idle keeps its own three intensities.
 *
 * This module has no content imports so interface code can share it.
 */

/** Reaction intensities from Mild (1) to Intense (4). */
export const REACTION_INTENSITIES = [1, 2, 3, 4] as const;
export type EmotionReactionIntensity = (typeof REACTION_INTENSITIES)[number];

/** The most Reactions one cell's pool may hold. */
export const REACTION_POOL_LIMIT = 4;

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
