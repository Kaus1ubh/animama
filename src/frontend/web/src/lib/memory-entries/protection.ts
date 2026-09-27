import type {
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import { isReservedUserMemoryEntry } from "@/lib/memory-entries/anima-folders";

type MemoryEntryLike = PyMemoryEntryHeader | PyMemoryEntryResponse;

const EPISODE_LOG_KIND = "episode_log";
const EPISODES_ROOT_PATH = "episodes";

export function isGeneratedEpisodePath(path: string | null | undefined) {
  return (
    path === EPISODES_ROOT_PATH ||
    path?.startsWith(`${EPISODES_ROOT_PATH}/`) === true
  );
}

export function isEpisodeLogEntry(entry: MemoryEntryLike) {
  return entry.kind === EPISODE_LOG_KIND || isGeneratedEpisodePath(entry.path);
}

/** Matches the backend's required identity, including legacy untyped seeds. */
export function isAnimaIdentityEntry(entry: MemoryEntryLike) {
  return (
    entry.scope === "anima" &&
    entry.type === "file" &&
    (entry.kind === "anima_identity" ||
      entry.path.toLowerCase() === "identity.md")
  );
}

/**
 * Matches an Anima's protected relationship `MEMORIES.md`. Like the identity it
 * cannot be renamed, moved or deleted, but it may be saved blank and carries no
 * Anima aggregate revision.
 */
export function isAnimaMemoriesEntry(entry: MemoryEntryLike) {
  return (
    entry.scope === "anima" &&
    entry.type === "file" &&
    (entry.kind === "anima_memories" ||
      entry.path.toLowerCase() === "memories.md")
  );
}

/** Shown when a save would leave a required Anima identity blank. */
export const BLANK_ANIMA_IDENTITY_MESSAGE = "Anima identity cannot be blank.";

/** True when saving `content` would blank a required Anima identity. */
export function isBlankAnimaIdentityDraft(
  entry: MemoryEntryLike,
  content: string,
) {
  return isAnimaIdentityEntry(entry) && !content.trim();
}

/** Required files are editable in place but never renamed, moved or deleted. */
export function isRequiredMemoryEntry(entry: MemoryEntryLike) {
  return (
    entry.kind === "user_profile" ||
    isAnimaIdentityEntry(entry) ||
    isAnimaMemoriesEntry(entry)
  );
}

export function canEditMemoryEntry(entry: MemoryEntryLike) {
  return !isEpisodeLogEntry(entry) && !isReservedUserMemoryEntry(entry);
}

export function canDeleteMemoryEntry(entry: MemoryEntryLike) {
  return !isEpisodeLogEntry(entry) && !isRequiredMemoryEntry(entry);
}
