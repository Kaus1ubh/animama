import { getI18n } from "react-i18next";

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
  const t = getI18n().getFixedT(null, "memory");
  const actions: MemoryExplorerAction[] = [];

  if (type === "directory") {
    actions.push(
      { id: "new-file", label: t("explorer.actions.newFile"), disabled: true },
      {
        id: "new-directory",
        label: t("explorer.actions.newDirectory"),
        disabled: true,
      },
    );
  }
  actions.push(
    {
      id: "rename",
      label: t("explorer.actions.rename"),
      disabled: true,
      separatorBefore: type === "directory",
    },
    { id: "move", label: t("explorer.actions.move"), disabled: true },
    {
      id: "delete",
      label: t("explorer.actions.delete"),
      disabled: true,
      destructive: true,
      separatorBefore: true,
    },
  );
  return actions;
}

/** Returns the canonical ellipsis/right-click actions for one physical row. */
export function memoryExplorerRowActions(entry: PyMemoryEntryHeader) {
  const t = getI18n().getFixedT(null, "memory");
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
      { id: "new-file", label: t("explorer.actions.newFile") },
      { id: "new-directory", label: t("explorer.actions.newDirectory") },
    );
  }
  if (canRelocate) {
    actions.push(
      {
        id: "rename",
        label: t("explorer.actions.rename"),
        separatorBefore: canCreateChildren,
      },
      { id: "move", label: t("explorer.actions.move") },
    );
  }
  if (canDeleteMemoryEntry(entry)) {
    actions.push({
      id: "delete",
      label: t("explorer.actions.delete"),
      destructive: true,
      separatorBefore: actions.length > 0,
    });
  }
  return actions;
}
