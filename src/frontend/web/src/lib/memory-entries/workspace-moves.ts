import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { isReservedUserMemoryEntry } from "@/lib/memory-entries/anima-folders";
import {
  isEpisodeLogEntry,
  isRequiredMemoryEntry,
} from "@/lib/memory-entries/protection";
import {
  isMemoryEntryDraftDirty,
  type MemoryEntryDrafts,
} from "@/lib/memory-entries/workspace-drafts";

export type MemoryMoveDestination = {
  parentId: string | null;
  label: string;
  path: string | null;
  disabled: boolean;
  reason: string | null;
};

export type MemoryMoveValidation = {
  valid: boolean;
  reason: string | null;
};

export type MemoryMovePath = {
  entryId: string;
  type: "file" | "directory";
  oldPath: string;
  newPath: string;
};

/** Limits explorer moves to user-authored physical entries. */
export function canMoveMemoryEntry(entry: PyMemoryEntryHeader) {
  return !isEpisodeLogEntry(entry) && !isRequiredMemoryEntry(entry);
}

/** Returns a physical entry and every descendant linked by stable parent IDs. */
export function memoryEntrySubtree(
  entries: PyMemoryEntryHeader[],
  sourceId: string,
) {
  const source = entries.find((entry) => entry.id === sourceId);
  if (!source) return [];

  const childrenByParent = new Map<string, PyMemoryEntryHeader[]>();
  for (const entry of entries) {
    if (!entry.parent_id) continue;
    const children = childrenByParent.get(entry.parent_id) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parent_id, children);
  }

  const result: PyMemoryEntryHeader[] = [];
  const pending = [source];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const entry = pending.shift();
    if (!entry || visited.has(entry.id)) continue;
    visited.add(entry.id);
    result.push(entry);
    pending.push(...(childrenByParent.get(entry.id) ?? []));
  }
  return result;
}

/**
 * Applies client-visible destination rules before the backend revalidates.
 * `reason` is worded in the active UI Locale.
 */
export function validateMemoryMoveDestination({
  source,
  destination,
  entries,
}: {
  source: PyMemoryEntryHeader;
  destination: PyMemoryEntryHeader | null;
  entries: PyMemoryEntryHeader[];
}): MemoryMoveValidation {
  const t = getI18n().getFixedT(null, "memory");
  if (!canMoveMemoryEntry(source)) {
    return { valid: false, reason: t("move.reasons.cannotMove") };
  }
  if (!destination) {
    return source.parent_id === null || source.parent_id === undefined
      ? { valid: false, reason: t("move.reasons.alreadyInRoot") }
      : { valid: true, reason: null };
  }
  if (destination.type !== "directory" || isEpisodeLogEntry(destination)) {
    return { valid: false, reason: t("move.reasons.chooseDirectory") };
  }
  if (isReservedUserMemoryEntry(destination)) {
    return { valid: false, reason: t("move.reasons.reserved") };
  }
  if ((destination.anima_id ?? null) !== (source.anima_id ?? null)) {
    return { valid: false, reason: t("move.reasons.otherScope") };
  }
  if (destination.id === source.parent_id) {
    return { valid: false, reason: t("move.reasons.alreadyInDirectory") };
  }
  if (destination.id === source.id) {
    return { valid: false, reason: t("move.reasons.containsItself") };
  }
  if (
    source.type === "directory" &&
    memoryEntrySubtree(entries, source.id).some(
      (entry) => entry.id === destination.id,
    )
  ) {
    return { valid: false, reason: t("move.reasons.insideDescendant") };
  }
  return { valid: true, reason: null };
}

/**
 * Builds the root-first searchable directory choices for the move dialog,
 * worded with `t` (the active UI Locale by default).
 */
export function memoryMoveDestinations(
  entries: PyMemoryEntryHeader[],
  source: PyMemoryEntryHeader,
  t: TFunction<"memory"> = getI18n().getFixedT(null, "memory"),
): MemoryMoveDestination[] {
  const rootValidation = validateMemoryMoveDestination({
    source,
    destination: null,
    entries,
  });
  const directories = entries
    .filter((entry) => entry.type === "directory" && !isEpisodeLogEntry(entry))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => {
      const validation = validateMemoryMoveDestination({
        source,
        destination: entry,
        entries,
      });
      return {
        parentId: entry.id,
        label: entry.name,
        path: entry.path,
        disabled: !validation.valid,
        reason: validation.reason,
      } satisfies MemoryMoveDestination;
    });

  return [
    {
      parentId: null,
      label: t("move.root"),
      path: null,
      disabled: !rootValidation.valid,
      reason: rootValidation.reason,
    },
    ...directories,
  ];
}

/** Projects a source or descendant path under the moved root's new path. */
export function projectMemoryMovePath(
  path: string,
  oldRootPath: string,
  newRootPath: string,
) {
  if (path === oldRootPath) return newRootPath;
  const prefix = `${oldRootPath}/`;
  if (!path.startsWith(prefix)) return null;
  return `${newRootPath}/${path.slice(prefix.length)}`;
}

export function memoryMovePaths(
  affectedEntries: PyMemoryEntryHeader[],
  oldRootPath: string,
  newRootPath: string,
): MemoryMovePath[] {
  return affectedEntries.flatMap((entry) => {
    const newPath = projectMemoryMovePath(entry.path, oldRootPath, newRootPath);
    return newPath
      ? [{ entryId: entry.id, type: entry.type, oldPath: entry.path, newPath }]
      : [];
  });
}

/** Advances move-only draft baselines without treating path versions as edits. */
export function rebaseMemoryEntryDraftsAfterMove({
  drafts,
  beforeEntries,
  refreshedEntries,
  oldRootPath,
  newRootPath,
}: {
  drafts: MemoryEntryDrafts;
  beforeEntries: PyMemoryEntryHeader[];
  refreshedEntries: PyMemoryEntryHeader[];
  oldRootPath: string;
  newRootPath: string;
}): MemoryEntryDrafts {
  const refreshedById = new Map(
    refreshedEntries.map((entry) => [entry.id, entry]),
  );
  let next = drafts;

  for (const before of beforeEntries) {
    const draft = drafts[before.id];
    if (!draft) continue;
    const refreshed = refreshedById.get(before.id);
    const projectedPath = projectMemoryMovePath(
      before.path,
      oldRootPath,
      newRootPath,
    );
    const moveOnly =
      refreshed &&
      projectedPath === refreshed.path &&
      refreshed.version === before.version + 1 &&
      draft.baseVersion === before.version;

    if (moveOnly) {
      if (next === drafts) next = { ...drafts };
      next[before.id] = {
        ...draft,
        baseVersion: refreshed.version,
      };
    } else if (isMemoryEntryDraftDirty(draft) && !draft.conflict) {
      if (next === drafts) next = { ...drafts };
      next[before.id] = { ...draft, conflict: true };
    }
  }
  return next;
}
