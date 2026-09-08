import type {
  PyMemoryEntryResponse,
  PyMemoryEntryVersionDetail,
} from "@/lib/content/catalogTypes";
import { canEditMemoryEntry } from "@/lib/memory-entries/protection";

export type MemoryEntryRevertAction = "hidden" | "discard" | "confirm";

export function memoryEntryRevertAction({
  entry,
  targetVersion,
  draftDirty,
  draftConflict,
}: {
  entry: PyMemoryEntryResponse | null;
  targetVersion: number | null;
  draftDirty: boolean;
  draftConflict: boolean;
}): MemoryEntryRevertAction {
  if (
    !entry ||
    !canEditMemoryEntry(entry) ||
    targetVersion === null ||
    targetVersion >= entry.version
  ) {
    return "hidden";
  }
  return draftDirty || draftConflict ? "discard" : "confirm";
}

/** Builds the exact current-versus-target values shown before Revert. */
export function memoryEntryRevertComparison(
  entry: PyMemoryEntryResponse,
  target: PyMemoryEntryVersionDetail,
) {
  const currentContent = entry.content ?? "";
  const targetContent = target.content ?? "";
  const currentDescription = entry.description ?? "";
  const targetDescription = target.description ?? "";
  return {
    currentContent,
    targetContent,
    currentDescription,
    targetDescription,
    hasChanges:
      currentContent !== targetContent ||
      currentDescription !== targetDescription,
  };
}
