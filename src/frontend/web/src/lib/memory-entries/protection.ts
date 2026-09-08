import type {
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";

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

export function isRequiredMemoryEntry(entry: MemoryEntryLike) {
  return (
    entry.kind === "user_profile" ||
    (entry.scope === "anima" &&
      entry.type === "file" &&
      (entry.kind === "anima_identity" ||
        entry.path.toLowerCase() === "identity.md"))
  );
}

export function canEditMemoryEntry(entry: MemoryEntryLike) {
  return !isEpisodeLogEntry(entry);
}

export function canDeleteMemoryEntry(entry: MemoryEntryLike) {
  return !isEpisodeLogEntry(entry) && !isRequiredMemoryEntry(entry);
}
