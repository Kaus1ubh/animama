import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";

export type MemoryEntryDraft = {
  entryId: string;
  baseVersion: number;
  /** Identity edits also fence name/equipment changes on their live Anima. */
  baseAggregateRevision?: number | null;
  baselineContent: string;
  baselineDescription: string;
  content: string;
  description: string;
  conflict: boolean;
};

export type MemoryEntryDrafts = Record<string, MemoryEntryDraft>;

export function createMemoryEntryDraft(
  entry: PyMemoryEntryResponse,
): MemoryEntryDraft {
  const content = entry.content ?? "";
  const description = entry.description ?? "";
  return {
    entryId: entry.id,
    baseVersion: entry.version,
    ...(entry.aggregate_revision != null
      ? { baseAggregateRevision: entry.aggregate_revision }
      : {}),
    baselineContent: content,
    baselineDescription: description,
    content,
    description,
    conflict: false,
  };
}

export function isMemoryEntryDraftDirty(draft: MemoryEntryDraft) {
  return (
    draft.content !== draft.baselineContent ||
    draft.description !== draft.baselineDescription
  );
}

export function dirtyMemoryEntryDrafts(drafts: MemoryEntryDrafts) {
  return Object.values(drafts).filter(isMemoryEntryDraftDirty);
}

/** Synchronizes clean drafts and preserves dirty drafts across server versions. */
export function syncMemoryEntryDraft(
  current: MemoryEntryDraft | undefined,
  entry: PyMemoryEntryResponse,
) {
  if (!current) return createMemoryEntryDraft(entry);
  if (
    current.baseVersion === entry.version &&
    (current.baseAggregateRevision ?? null) ===
      (entry.aggregate_revision ?? null)
  )
    return current;
  if (isMemoryEntryDraftDirty(current)) {
    return current.conflict ? current : { ...current, conflict: true };
  }
  return createMemoryEntryDraft(entry);
}

export function updateMemoryEntryDraft(
  draft: MemoryEntryDraft,
  update: Partial<Pick<MemoryEntryDraft, "content" | "description">>,
) {
  return { ...draft, ...update };
}

export function commitMemoryEntryDraft(
  entry: PyMemoryEntryResponse,
): MemoryEntryDraft {
  return createMemoryEntryDraft(entry);
}

export function discardMemoryEntryDraft(entry: PyMemoryEntryResponse) {
  return createMemoryEntryDraft(entry);
}

/** Saves dirty drafts in stable insertion order and stops at the first failure. */
export async function saveMemoryEntryDraftsSequentially(
  drafts: MemoryEntryDrafts,
  save: (draft: MemoryEntryDraft) => Promise<void>,
) {
  for (const draft of dirtyMemoryEntryDrafts(drafts)) {
    await save(draft);
  }
}
