export const RUNTIME_ASSET_ID_MAX_LENGTH = 64;
export const RUNTIME_ASSET_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Normalize a trusted catalog identifier into the cross-runtime ID syntax. */
export function normalizeRuntimeContentId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  assertRuntimeContentId(normalized);
  return normalized;
}

/** Reject IDs that cannot be safely shared by frontend, backend, URLs, and tools. */
export function assertRuntimeContentId(value: string): void {
  if (
    value.length === 0 ||
    value.length > RUNTIME_ASSET_ID_MAX_LENGTH ||
    !RUNTIME_ASSET_ID_PATTERN.test(value)
  ) {
    throw new Error(`Invalid runtime content id: ${JSON.stringify(value)}`);
  }
}
