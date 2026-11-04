/**
 * Type guards for reading unknown values, such as parsed JSON, stored settings
 * and messages from other windows. Product UI keeps its own local guards, since
 * packages cannot import the web app.
 */

/** A non-null object that is not an array, such as a parsed JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Any non-null object, arrays included. */
export function isNonNullObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
