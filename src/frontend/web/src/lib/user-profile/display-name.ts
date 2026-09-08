export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Normalize private personalization; null means the input cannot be saved. */
export function normalizeLocalDisplayName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= DISPLAY_NAME_MAX_LENGTH
    ? normalized
    : null;
}
