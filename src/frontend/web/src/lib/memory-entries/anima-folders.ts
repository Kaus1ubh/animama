import type {
  PyAnimaIdentityItem,
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import {
  isMemoryEntryDraftDirty,
  type MemoryEntryDrafts,
} from "@/lib/memory-entries/workspace-drafts";

/** Visible name of the virtual directory holding each Anima's protected files. */
export const ANIMAS_WORKSPACE_LABEL = "Animas";
/** User-scope path the backend reserves for that virtual directory. */
const RESERVED_USER_ROOT = "animas";
const ANIMA_IDENTITY_FILE_NAME = "IDENTITY.md";
const ANIMA_MEMORIES_FILE_NAME = "MEMORIES.md";

/** One protected file in an Anima folder. */
export type MemoryAnimaFile = {
  /** File name shown in the folder. */
  name: string;
  /** Label path shown to the owner and accepted in workspace URLs. */
  path: string;
  /** Live header, or null when the file is missing and needs repair. */
  entry: PyMemoryEntryHeader | null;
};

/** One owned Anima's virtual folder in the Memory workspace. */
export type MemoryAnimaFolder = {
  animaId: string;
  /** Current name, suffixed ` (2)`, ` (3)`… by creation order when shared. */
  label: string;
  /** Owner-authored `IDENTITY.md`, part of the Anima definition. */
  identity: MemoryAnimaFile;
  /** Relationship `MEMORIES.md`, repairable separately from the identity. */
  memories: MemoryAnimaFile;
};

/** Returns a folder's files in display order: identity, then memories. */
export function animaFolderFiles(folder: MemoryAnimaFolder) {
  return [folder.identity, folder.memories];
}

function folderName(identity: PyAnimaIdentityItem) {
  return identity.display_name.trim() || identity.anima_id;
}

function animaFile(
  folderPath: string,
  entry: PyMemoryEntryHeader | null | undefined,
  defaultName: string,
): MemoryAnimaFile {
  // Legacy identities may be stored as `identity.md`; show the stored name.
  const name = entry?.name ?? defaultName;
  return { name, path: `${folderPath}/${name}`, entry: entry ?? null };
}

/**
 * Labels owned Animas for the explorer. The backend lists them in creation
 * order, so the earliest keeps the plain name and later duplicates are
 * suffixed; a suffix that any Anima really uses as its name is skipped.
 */
export function buildMemoryAnimaFolders(
  identities: PyAnimaIdentityItem[],
): MemoryAnimaFolder[] {
  const realNames = new Set(identities.map(folderName));
  const used = new Set<string>();
  return identities.map((identity) => {
    const base = folderName(identity);
    let label = base;
    for (
      let suffix = 2;
      used.has(label) || (label !== base && realNames.has(label));
      suffix += 1
    ) {
      label = `${base} (${suffix})`;
    }
    used.add(label);
    const folderPath = `${ANIMAS_WORKSPACE_LABEL}/${label}`;
    return {
      animaId: identity.anima_id,
      label,
      identity: animaFile(folderPath, identity.entry, ANIMA_IDENTITY_FILE_NAME),
      memories: animaFile(
        folderPath,
        identity.memories_entry,
        ANIMA_MEMORIES_FILE_NAME,
      ),
    };
  });
}

/** True for URL paths that address the virtual Animas directory. */
export function isAnimaWorkspacePath(path: string | null | undefined) {
  return path?.startsWith(`${ANIMAS_WORKSPACE_LABEL}/`) === true;
}

/**
 * Mirrors the backend reservation: a user-scope entry at `animas` or beneath
 * it predates the virtual directory and must be moved before it is edited.
 */
export function isReservedUserMemoryEntry(
  entry: PyMemoryEntryHeader | PyMemoryEntryResponse,
) {
  if (entry.scope !== "user") return false;
  const path = entry.path.toLowerCase();
  return (
    path === RESERVED_USER_ROOT || path.startsWith(`${RESERVED_USER_ROOT}/`)
  );
}

/**
 * Resolves the workspace file named by route state. Anima files are always
 * reached through their folder label path, never their stored `IDENTITY.md` or
 * `MEMORIES.md` path; a label-path hit asks the caller to pin the URL to the
 * entry ID so the selection survives renames and duplicate-label shifts.
 */
export function resolveWorkspaceSelection({
  entries,
  folders,
  entryId,
  path,
}: {
  entries: PyMemoryEntryHeader[];
  folders: MemoryAnimaFolder[];
  entryId: string | null | undefined;
  path: string | null | undefined;
}): { header: PyMemoryEntryHeader | null; pinEntryId: boolean } {
  const files = entries.filter((entry) => entry.type === "file");
  if (entryId) {
    const byId = files.find((entry) => entry.id === entryId);
    if (byId) return { header: byId, pinEntryId: false };
  }
  if (!path) return { header: null, pinEntryId: false };
  const labelled = folders
    .flatMap(animaFolderFiles)
    .find((candidate) => candidate.path === path);
  if (labelled?.entry) return { header: labelled.entry, pinEntryId: true };
  const userFile = files.find(
    (entry) => !entry.anima_id && entry.path === path,
  );
  return { header: userFile ?? null, pinEntryId: false };
}

export type RemovedAnimaFileNotice = {
  entryId: string;
  /** Folder label of the Anima that owned the file. */
  label: string;
  fileName: string;
  reason: "deleted" | "unavailable";
};

/**
 * Drops drafts whose Anima file left the listing. A dirty draft yields a
 * notice: `deleted` when its Anima is gone, `unavailable` when the Anima
 * remains but the file now needs repair. Returns the input drafts object when
 * unchanged.
 */
export function removedAnimaFileDrafts({
  previous,
  current,
  drafts,
}: {
  previous: MemoryAnimaFolder[];
  current: MemoryAnimaFolder[];
  drafts: MemoryEntryDrafts;
}): { drafts: MemoryEntryDrafts; notices: RemovedAnimaFileNotice[] } {
  const liveEntryIds = new Set(
    current
      .flatMap(animaFolderFiles)
      .flatMap((file) => (file.entry ? [file.entry.id] : [])),
  );
  const liveAnimaIds = new Set(current.map((folder) => folder.animaId));
  const notices: RemovedAnimaFileNotice[] = [];
  let next = drafts;
  for (const folder of previous) {
    for (const file of animaFolderFiles(folder)) {
      const entryId = file.entry?.id;
      if (!entryId || liveEntryIds.has(entryId) || !drafts[entryId]) continue;
      if (next === drafts) next = { ...drafts };
      if (isMemoryEntryDraftDirty(drafts[entryId])) {
        notices.push({
          entryId,
          label: folder.label,
          fileName: file.name,
          reason: liveAnimaIds.has(folder.animaId) ? "unavailable" : "deleted",
        });
      }
      delete next[entryId];
    }
  }
  return { drafts: next, notices };
}

const MANAGER_IDENTITY_PATH = /^animas\/([^/]+)\/identity\.md$/i;

/**
 * Returns the Anima ID in a Memory Manager identity path
 * (`animas/<anima_id>/IDENTITY.md`), or null for user memory.
 */
export function animaIdForManagerPath(path: string) {
  return MANAGER_IDENTITY_PATH.exec(path)?.[1] ?? null;
}

/** Shows a Memory Manager target by its owner-facing workspace path. */
export function managerPathLabel(path: string, folders: MemoryAnimaFolder[]) {
  const animaId = animaIdForManagerPath(path);
  if (!animaId) return path;
  return (
    folders.find((folder) => folder.animaId === animaId)?.identity.path ?? path
  );
}
