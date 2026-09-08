/**
 * Resolve the model's happy expression without assuming VRM authoring casing.
 * Exact lowercase wins; pathological case-collisions use stable lexical order.
 */
export function resolveAvatarPortraitHappyExpression(
  expressionNames: readonly string[],
): string | null {
  if (expressionNames.includes("happy")) return "happy";

  return (
    expressionNames
      .filter((name) => name.toLowerCase() === "happy")
      .sort((left, right) => left.localeCompare(right, "en"))[0] ?? null
  );
}
