/**
 * Read the expression thresholds a Reaction Clip must visibly reach: every
 * authored track that peaks at or above `minimum`. Reactions may key whole-face
 * presets (`happy`) or VRoid face parts (`Fcl_EYE_Joy`), so proofs of imported
 * content read the clip instead of assuming a preset.
 */
export function authoredExpressionThresholds(
  clip: unknown,
  minimum = 0.4,
): Record<string, number> {
  const expressions =
    clip && typeof clip === "object"
      ? (clip as { expressions?: unknown }).expressions
      : undefined;
  const thresholds: Record<string, number> = {};
  if (expressions && typeof expressions === "object") {
    for (const [name, keys] of Object.entries(expressions)) {
      // Non-numeric keys such as `"base"` follow the resting face; skip them.
      const peak = Math.max(
        ...(Array.isArray(keys) ? keys : [])
          .map((key) => (key as { v?: unknown } | null)?.v)
          .filter((value): value is number => Number.isFinite(value)),
      );
      if (peak >= minimum) thresholds[name] = minimum;
    }
  }
  if (Object.keys(thresholds).length === 0) {
    throw new Error(
      `Reaction Clip has no expression track that peaks at ${minimum} or more.`,
    );
  }
  return thresholds;
}
