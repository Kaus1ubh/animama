/**
 * Identifiers and file names derived from user-entered names.
 *
 * Identifiers stay ASCII so they are valid for every model API, file system and
 * backend pattern. A name that folds to ASCII keeps exactly the identifier it
 * always had. When folding would drop a letter or digit (Japanese, Korean,
 * Chinese and other scripts), a short stable hash of the name is appended so
 * names in other scripts do not share an identifier. The backend's path names
 * (`animama/app/services/content_names.py`) use the same hash.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a (32-bit) of the trimmed name's NFC UTF-8 bytes, as 7 base-36 characters. */
export function nameHash(name: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(name.trim().normalize("NFC"))) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/** True when ASCII folding would drop a letter or digit from the name. */
export function foldingDropsCharacters(name: string): boolean {
  return /[\p{L}\p{N}]/u.test(
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[A-Za-z0-9]/g, ""),
  );
}

/**
 * Make a folded identifier distinct for its name: unchanged when folding was
 * lossless, otherwise suffixed with the name's hash (on `stem` when nothing
 * ASCII remains).
 */
export function withNameHash(
  name: string,
  folded: string,
  {
    separator,
    stem,
    empty,
    maxLength,
  }: { separator: string; stem: string; empty: string; maxLength: number },
): string {
  if (!foldingDropsCharacters(name)) return folded || empty;
  const suffix = `${separator}${nameHash(name)}`;
  return `${(folded || stem).slice(0, maxLength - suffix.length)}${suffix}`;
}

/** Lowercase, hyphenated file-name and logical-key stem for a content name. */
export function contentSlug(name: string, maxLength = 96): string {
  const folded = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return withNameHash(name, folded, {
    separator: "-",
    stem: "untitled",
    empty: "untitled",
    maxLength,
  });
}

const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;

/** ASCII words of a non-ASCII name, with its hash when letters were dropped. */
function portableName(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  return withNameHash(name, folded, {
    separator: "-",
    stem: "item",
    empty: folded,
    maxLength: 120,
  });
}

/**
 * The Local entry name the backend saves a display name under
 * (`content_save_service.readable_entry_name`), or `null` when it would reject
 * the name. Used to recognize an existing file before a Save.
 */
export function contentEntryName(name: string): string | null {
  let entry = name.trim();
  if (!/^\p{ASCII}*$/u.test(entry)) entry = portableName(entry);
  if (!ENTRY_NAME.test(entry)) return null;
  const normalized = entry
    .replace(/[ _]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized && normalized !== "." && normalized !== ".."
    ? normalized
    : null;
}
