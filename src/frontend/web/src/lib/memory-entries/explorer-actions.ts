import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { isReservedUserMemoryEntry } from "@/lib/memory-entries/anima-folders";
import {
  canDeleteMemoryEntry,
  isEpisodeLogEntry,
} from "@/lib/memory-entries/protection";
import { canMoveMemoryEntry } from "@/lib/memory-entries/workspace-moves";

export type MemoryExplorerActionId =
  | "new-file"
  | "new-directory"
  | "rename"
  | "move"
  | "delete";

export type MemoryExplorerAction = {
  id: MemoryExplorerActionId;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

/** Keeps protected rows discoverable without permitting filesystem changes. */
export function memoryExplorerProtectedRowActions(
  type: "file" | "directory",
): MemoryExplorerAction[] {
  const actions: MemoryExplorerAction[] = [];

  if (type === "directory") {
    actions.push(
      { id: "new-file", label: "New file", disabled: true },
      { id: "new-directory", label: "New directory", disabled: true },
    );
  }
  actions.push(
    {
      id: "rename",
      label: "Rename",
      disabled: true,
      separatorBefore: type === "directory",
    },
    { id: "move", label: "Move to…", disabled: true },
    {
      id: "delete",
      label: "Delete",
      disabled: true,
      destructive: true,
      separatorBefore: true,
    },
  );
  return actions;
}

/** Returns the canonical ellipsis/right-click actions for one physical row. */
export function memoryExplorerRowActions(entry: PyMemoryEntryHeader) {
  const actions: MemoryExplorerAction[] = [];
  const canCreateChildren =
    entry.type === "directory" &&
    !isEpisodeLogEntry(entry) &&
    !isReservedUserMemoryEntry(entry);
  const canRelocate = canMoveMemoryEntry(entry);

  if (!canRelocate && !canDeleteMemoryEntry(entry)) {
    return memoryExplorerProtectedRowActions(entry.type);
  }

  if (canCreateChildren) {
    actions.push(
      { id: "new-file", label: "New file" },
      { id: "new-directory", label: "New directory" },
    );
  }
  if (canRelocate) {
    actions.push(
      {
        id: "rename",
        label: "Rename",
        separatorBefore: canCreateChildren,
      },
      { id: "move", label: "Move to…" },
    );
  }
  if (canDeleteMemoryEntry(entry)) {
    actions.push({
      id: "delete",
      label: "Delete",
      destructive: true,
      separatorBefore: actions.length > 0,
    });
  }
  return actions;
}
