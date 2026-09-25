import type {
  PyAnimaIdentityItem,
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import {
  isMemoryEntryDraftDirty,
  type MemoryEntryDrafts,
} from "@/lib/memory-entries/workspace-drafts";

/** Visible name of the virtual directory holding each Anima's identity. */
export const ANIMAS_WORKSPACE_LABEL = "Animas";
/** User-scope path the backend reserves for that virtual directory. */
const RESERVED_USER_ROOT = "animas";

/** One owned Anima's virtual folder in the Memory workspace. */
export type MemoryAnimaFolder = {
  animaId: string;
  /** Current name, suffixed ` (2)`, ` (3)`… by creation order when shared. */
  label: string;
  /** Label path shown to the owner and accepted in workspace URLs. */
  path: string;
  /** Live identity header, or null when the identity needs explicit repair. */
  entry: PyMemoryEntryHeader | null;
};

function folderName(identity: PyAnimaIdentityItem) {
  return identity.display_name.trim() || identity.anima_id;
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
    return {
      animaId: identity.anima_id,
      label,
      path: `${ANIMAS_WORKSPACE_LABEL}/${label}/${identity.entry?.name ?? "IDENTITY.md"}`,
      entry: identity.entry ?? null,
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
 * Resolves the workspace file named by route state. Identities are always
 * reached through their folder label path, never their stored `IDENTITY.md`
 * path; a label-path hit asks the caller to pin the URL to the entry ID so the
 * selection survives renames and duplicate-label shifts.
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
  const folder = folders.find((candidate) => candidate.path === path);
  if (folder?.entry) return { header: folder.entry, pinEntryId: true };
  const userFile = files.find(
    (entry) => !entry.anima_id && entry.path === path,
  );
  return { header: userFile ?? null, pinEntryId: false };
}

export type RemovedIdentityNotice = {
  entryId: string;
  label: string;
  reason: "deleted" | "unavailable";
};

/**
 * Drops drafts whose identity left the listing. A dirty draft yields a notice:
 * `deleted` when its Anima is gone, `unavailable` when the Anima remains but its
 * identity now needs repair. Returns the input drafts object when unchanged.
 */
export function removedIdentityDrafts({
  previous,
  current,
  drafts,
}: {
  previous: MemoryAnimaFolder[];
  current: MemoryAnimaFolder[];
  drafts: MemoryEntryDrafts;
}): { drafts: MemoryEntryDrafts; notices: RemovedIdentityNotice[] } {
  const liveEntryIds = new Set(
    current.flatMap((folder) => (folder.entry ? [folder.entry.id] : [])),
  );
  const liveAnimaIds = new Set(current.map((folder) => folder.animaId));
  const notices: RemovedIdentityNotice[] = [];
  let next = drafts;
  for (const folder of previous) {
    const entryId = folder.entry?.id;
    if (!entryId || liveEntryIds.has(entryId) || !drafts[entryId]) continue;
    if (next === drafts) next = { ...drafts };
    if (isMemoryEntryDraftDirty(drafts[entryId])) {
      notices.push({
        entryId,
        label: folder.label,
        reason: liveAnimaIds.has(folder.animaId) ? "unavailable" : "deleted",
      });
    }
    delete next[entryId];
  }
  return { drafts: next, notices };
}
