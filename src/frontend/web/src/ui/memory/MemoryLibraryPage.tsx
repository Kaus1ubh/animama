"use client";

import { AlertTriangle, Eye, Files, Loader2, Pencil } from "lucide-react";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import {
  animaFolderFiles,
  buildMemoryAnimaFolders,
  isAnimaWorkspacePath,
  removedAnimaFileDrafts,
  resolveWorkspaceSelection,
  type MemoryAnimaFolder,
} from "@/lib/memory-entries/anima-folders";
import {
  MemoryEntryApiError,
  isMemoryEntryConflict,
  memoryEntryErrorMessage,
} from "@/lib/memory-entries/errors";
import {
  modeForMemoryEntrySelection,
  shouldBlockMemoryWorkspaceExit,
  type MemoryLibrarySearch,
  type MemoryLibrarySearchUpdate,
  type MemoryWorkspaceMode,
} from "@/lib/memory-entries/library-search";
import {
  canDeleteMemoryEntry,
  BLANK_ANIMA_IDENTITY_MESSAGE,
  canEditMemoryEntry,
  isBlankAnimaIdentityDraft,
  isEpisodeLogEntry,
} from "@/lib/memory-entries/protection";
import {
  commitMemoryEntryDraft,
  dirtyMemoryEntryDrafts,
  discardMemoryEntryDraft,
  isMemoryEntryDraftDirty,
  saveMemoryEntryDraftsSequentially,
  syncMemoryEntryDraft,
  updateMemoryEntryDraft,
  type MemoryEntryDraft,
  type MemoryEntryDrafts,
} from "@/lib/memory-entries/workspace-drafts";
import {
  canMoveMemoryEntry,
  memoryEntrySubtree,
  projectMemoryMovePath,
  rebaseMemoryEntryDraftsAfterMove,
  validateMemoryMoveDestination,
} from "@/lib/memory-entries/workspace-moves";
import {
  buildMemoryWorkspaceTree,
  defaultMemoryWorkspaceExpandedIds,
  findMemoryWorkspaceNode,
  memoryCreationTarget,
  memoryWorkspaceAncestorIds,
  resolveMemoryWorkspaceFileId,
  type MemoryWorkspaceTreeNode,
} from "@/lib/memory-entries/workspace-tree";
import { cn } from "@/lib/utils";
import { useMemoryEpisodes } from "@/query/hooks/useMemoryEpisodes";
import {
  useAnimaIdentities,
  useMemoryEntries,
  useMemoryEntry,
  useMemoryEntryByPath,
} from "@/query/hooks/useMemoryEntries";
import { useDeleteMemoryEntry } from "@/query/mutations/useDeleteMemoryEntry";
import { useMoveMemoryEntry } from "@/query/mutations/useMoveMemoryEntry";
import { usePatchMemoryEntry } from "@/query/mutations/usePatchMemoryEntry";
import { useRepairAnimaMemories } from "@/query/mutations/useRepairAnimaMemories";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  MemoryCreateEntryDialog,
  type CreateMemoryEntryKind,
} from "@/ui/memory/MemoryCreateEntryDialog";
import { MemoryFileExplorer } from "@/ui/memory/MemoryFileExplorer";
import { MemoryManagerPanel } from "@/ui/memory/MemoryManagerPanel";
import { MemoryManualPanel } from "@/ui/memory/MemoryManualPanel";
import { MemoryMoveEntryDialog } from "@/ui/memory/MemoryMoveEntryDialog";
import { MemoryRenameEntryDialog } from "@/ui/memory/MemoryRenameEntryDialog";
import { MemoryVersionsDialog } from "@/ui/memory/MemoryVersionsDialog";
import { MemoryWorkspacePreview } from "@/ui/memory/MemoryWorkspacePreview";
import { MemoryWorkspaceSplitLayout } from "@/ui/memory/MemoryWorkspaceSplitLayout";
import { useMemoryManagerWorkspace } from "@/ui/memory/useMemoryManagerWorkspace";

type MemoryLibraryPageProps = {
  search: MemoryLibrarySearch;
  onSearchChange: (
    next: MemoryLibrarySearchUpdate,
    options?: MemoryLibraryNavigationOptions,
  ) => void;
};

export type MemoryLibraryNavigationOptions = { replace?: boolean };
type MobileWorkspacePane = "files" | "work" | "preview";

const EMPTY_ENTRIES: PyMemoryEntryHeader[] = [];

export function MemoryLibraryPage({
  search,
  onSearchChange,
}: MemoryLibraryPageProps) {
  const [treeQuery, setTreeQuery] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState(
    () => new Set<string>(),
  );
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobileWorkspacePane>("work");
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<CreateMemoryEntryKind>("file");
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] =
    useState<PyMemoryEntryHeader | null>(null);
  const [renameSource, setRenameSource] = useState<PyMemoryEntryHeader | null>(
    null,
  );
  const [moveSource, setMoveSource] = useState<PyMemoryEntryHeader | null>(
    null,
  );
  const [movingEntryId, setMovingEntryId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<MemoryEntryDrafts>({});
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const initializedTreeRef = useRef(false);
  const moveReconciliationRef = useRef<Set<string> | null>(null);

  const userEntriesQuery = useMemoryEntries({ animaId: null, recursive: true });
  const identitiesQuery = useAnimaIdentities();
  const animaFolders = useMemo(
    () => buildMemoryAnimaFolders(identitiesQuery.data?.identities ?? []),
    [identitiesQuery.data],
  );
  // Selection falls back only once both sources have settled; an identity
  // listing failure still leaves user memory usable.
  const workspaceLoaded =
    userEntriesQuery.isSuccess &&
    (identitiesQuery.isSuccess || identitiesQuery.isError);
  const workspaceFetching =
    userEntriesQuery.isFetching || identitiesQuery.isFetching;
  /** Refreshes user memory and identities; returns the user-memory result. */
  const refreshWorkspace = async () => {
    const [users] = await Promise.all([
      userEntriesQuery.refetch(),
      identitiesQuery.refetch(),
    ]);
    return users;
  };
  // Each Anima's live identity and memories files, in folder display order.
  const animaFiles = useMemo(
    () =>
      animaFolders
        .flatMap(animaFolderFiles)
        .flatMap(({ entry, path }) => (entry ? [{ entry, path }] : [])),
    [animaFolders],
  );
  // User memory plus the Anima file headers, so selection, drafts and dirty
  // indicators treat Anima files like any other workspace file.
  const entries = useMemo(() => {
    const userEntries = userEntriesQuery.data?.entries ?? EMPTY_ENTRIES;
    return animaFiles.length > 0
      ? [...userEntries, ...animaFiles.map((file) => file.entry)]
      : userEntries;
  }, [animaFiles, userEntriesQuery.data]);
  const workspacePathById = useMemo(
    () => new Map(animaFiles.map((file) => [file.entry.id, file.path])),
    [animaFiles],
  );
  const tree = useMemo(
    () => buildMemoryWorkspaceTree(entries, undefined, animaFolders),
    [animaFolders, entries],
  );
  const selection = useMemo(
    () =>
      resolveWorkspaceSelection({
        entries,
        folders: animaFolders,
        entryId: search.entryId,
        path: search.path,
      }),
    [animaFolders, entries, search.entryId, search.path],
  );
  const selectedHeader = selection.header;
  const detailId = selectedHeader?.id ?? search.entryId ?? null;
  const detailById = useMemoryEntry(detailId, {
    enabled: Boolean(detailId),
  });
  const detailByPath = useMemoryEntryByPath({
    path: search.path,
    type: "file",
    // Anima file label paths resolve only through the loaded folder list.
    enabled:
      !detailId && Boolean(search.path) && !isAnimaWorkspacePath(search.path),
  });
  const selectedEntry = detailById.data ?? detailByPath.data ?? null;
  const selectedEntryId = selectedHeader?.id ?? selectedEntry?.id ?? null;
  const selectedLoading = detailById.isLoading || detailByPath.isLoading;
  const selectedError = detailById.isError || detailByPath.isError;
  const currentDraft = selectedEntryId
    ? (drafts[selectedEntryId] ?? null)
    : null;
  const dirtyDrafts = useMemo(() => dirtyMemoryEntryDrafts(drafts), [drafts]);
  const hasDirtyDrafts = dirtyDrafts.length > 0;
  const dirtyEntryIds = useMemo(
    () => new Set(dirtyDrafts.map((draft) => draft.entryId)),
    [dirtyDrafts],
  );
  const deletionEntries = useMemo(
    () => (entryToDelete ? memoryEntrySubtree(entries, entryToDelete.id) : []),
    [entries, entryToDelete],
  );
  const deletionEntryIds = useMemo(
    () => new Set(deletionEntries.map((entry) => entry.id)),
    [deletionEntries],
  );
  const deletionFileCount = deletionEntries.filter(
    (entry) => entry.type === "file",
  ).length;
  const deletionDirectoryCount = deletionEntries.filter(
    (entry) => entry.type === "directory" && entry.id !== entryToDelete?.id,
  ).length;
  const deletionDirtyDraftCount = dirtyDrafts.filter((draft) =>
    deletionEntryIds.has(draft.entryId),
  ).length;
  const focusedNode = useMemo(
    () =>
      findMemoryWorkspaceNode(tree, focusedNodeId) ??
      findMemoryWorkspaceNode(tree, selectedEntryId),
    [focusedNodeId, selectedEntryId, tree],
  );
  const creationTarget = memoryCreationTarget(focusedNode);

  const pendingEpisodes = useMemoryEpisodes({ status: "pending", limit: 100 });
  const pendingEpisodeCount = pendingEpisodes.data?.items?.length ?? 0;
  const patchEntry = usePatchMemoryEntry();
  const moveEntry = useMoveMemoryEntry();
  const deleteEntry = useDeleteMemoryEntry();
  const repairMemories = useRepairAnimaMemories();
  const manager = useMemoryManagerWorkspace({
    runId: search.managerRunId,
    onRunCreated: (runId) =>
      onSearchChange(
        { mode: "manager", managerRunId: runId },
        { replace: true },
      ),
    onRunRecovered: (runId) =>
      onSearchChange(
        { mode: "manager", managerRunId: runId },
        { replace: true },
      ),
    onRunCleared: () =>
      onSearchChange(
        { mode: "manager", managerRunId: null },
        { replace: true },
      ),
    onPendingEpisodesChanged: () => void pendingEpisodes.refetch(),
  });

  // Deleting an Anima removes its files. Drafts for them can no longer be
  // saved, so drop them and tell the owner when unsaved text is discarded.
  const previousFoldersRef = useRef<MemoryAnimaFolder[] | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    if (!identitiesQuery.isSuccess) return;
    const previous = previousFoldersRef.current;
    previousFoldersRef.current = animaFolders;
    if (!previous) return;
    const result = removedAnimaFileDrafts({
      previous,
      current: animaFolders,
      drafts: draftsRef.current,
    });
    if (result.drafts === draftsRef.current) return;
    setDrafts(result.drafts);
    for (const notice of result.notices) {
      toast.warning(
        notice.reason === "deleted"
          ? `${notice.label} was deleted.`
          : `${notice.label}'s ${notice.fileName} is unavailable.`,
        {
          id: `anima-file-removed:${notice.entryId}`,
          description: `Unsaved ${notice.fileName} changes could not be saved and were discarded.`,
        },
      );
    }
  }, [animaFolders, identitiesQuery.isSuccess]);

  useEffect(() => {
    if (identitiesQuery.isError) {
      toast.error("Could not load Anima identities.", {
        id: "anima-identities-error",
        description: "User memory is still available. Refresh to retry.",
      });
    }
  }, [identitiesQuery.isError]);

  useEffect(() => {
    if (!workspaceLoaded || moveReconciliationRef.current) return;
    const requestedId = selectedHeader?.id ?? search.entryId ?? null;
    const nextEntryId = resolveMemoryWorkspaceFileId(entries, requestedId);
    if (nextEntryId === requestedId && !search.path) return;
    // User-file path URLs stay readable; Anima file label paths are pinned to
    // their entry ID so a rename cannot retarget or lose the selection.
    const pathMatches =
      search.path &&
      selectedHeader?.id === nextEntryId &&
      !search.entryId &&
      !selection.pinEntryId;
    if (pathMatches) return;
    const staleEntryId = search.entryId;
    if (
      staleEntryId &&
      staleEntryId !== nextEntryId &&
      !entries.some((entry) => entry.id === staleEntryId)
    ) {
      setDrafts((current) => {
        if (!current[staleEntryId]) return current;
        const next = { ...current };
        delete next[staleEntryId];
        return next;
      });
    }
    onSearchChange({ entryId: nextEntryId, path: null }, { replace: true });
  }, [
    entries,
    workspaceLoaded,
    onSearchChange,
    search.entryId,
    search.path,
    selectedHeader?.id,
    selection.pinEntryId,
  ]);

  useEffect(() => {
    if (!workspaceLoaded || initializedTreeRef.current) return;
    initializedTreeRef.current = true;
    const initial = defaultMemoryWorkspaceExpandedIds(tree);
    for (const id of memoryWorkspaceAncestorIds(tree, selectedEntryId)) {
      initial.add(id);
    }
    setExpandedNodeIds(initial);
  }, [workspaceLoaded, selectedEntryId, tree]);

  useEffect(() => {
    if (!selectedEntryId) return;
    setExpandedNodeIds((current) => {
      const ancestors = memoryWorkspaceAncestorIds(tree, selectedEntryId);
      if (ancestors.every((id) => current.has(id))) return current;
      return new Set([...current, ...ancestors]);
    });
  }, [selectedEntryId, tree]);

  useEffect(() => {
    if (!selectedEntry || !canEditMemoryEntry(selectedEntry)) return;
    if (moveReconciliationRef.current?.has(selectedEntry.id)) return;
    setDrafts((current) => {
      const nextDraft = syncMemoryEntryDraft(
        current[selectedEntry.id],
        selectedEntry,
      );
      if (nextDraft === current[selectedEntry.id]) return current;
      return { ...current, [selectedEntry.id]: nextDraft };
    });
  }, [selectedEntry]);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      hasDirtyDrafts && shouldBlockMemoryWorkspaceExit(current, next),
    enableBeforeUnload: () => hasDirtyDrafts,
    withResolver: true,
  });

  const updateDraft = (
    update: Partial<Pick<MemoryEntryDraft, "content" | "description">>,
  ) => {
    if (!selectedEntryId) return;
    setDrafts((current) => {
      const draft = current[selectedEntryId];
      if (!draft) return current;
      return {
        ...current,
        [selectedEntryId]: updateMemoryEntryDraft(draft, update),
      };
    });
  };

  const saveDraft = useCallback(
    async (
      draft: MemoryEntryDraft,
      expectedVersion = draft.baseVersion,
      expectedAggregateRevision = draft.baseAggregateRevision,
    ) => {
      const header = entries.find((entry) => entry.id === draft.entryId);
      if (header && isBlankAnimaIdentityDraft(header, draft.content)) {
        toast.error(BLANK_ANIMA_IDENTITY_MESSAGE);
        throw new Error(BLANK_ANIMA_IDENTITY_MESSAGE);
      }
      try {
        const updated = await patchEntry.mutateAsync({
          entryId: draft.entryId,
          body: {
            expected_version: expectedVersion,
            expected_aggregate_revision: expectedAggregateRevision,
            content: draft.content,
            description: draft.description,
          },
        });
        setDrafts((current) => ({
          ...current,
          [updated.id]: commitMemoryEntryDraft(updated),
        }));
        return updated;
      } catch (error) {
        if (isMemoryEntryConflict(error)) {
          setDrafts((current) => {
            const currentDraft = current[draft.entryId];
            if (!currentDraft) return current;
            return {
              ...current,
              [draft.entryId]: { ...currentDraft, conflict: true },
            };
          });
          if (draft.entryId === selectedEntryId) {
            await detailById.refetch();
          }
          toast.error("This memory changed elsewhere.", {
            description: "Your draft is still open.",
          });
        } else {
          toast.error("Failed to save memory.", {
            description: memoryEntryErrorMessage(error),
          });
        }
        throw error;
      }
    },
    [detailById, entries, patchEntry, selectedEntryId],
  );

  const handleSaveCurrent = async (forceLatestVersion: boolean) => {
    if (!currentDraft || !selectedEntry) return;
    try {
      await saveDraft(
        currentDraft,
        forceLatestVersion ? selectedEntry.version : currentDraft.baseVersion,
        forceLatestVersion
          ? selectedEntry.aggregate_revision
          : currentDraft.baseAggregateRevision,
      );
      toast.success(forceLatestVersion ? "Draft saved." : "Memory saved.");
    } catch {
      // saveDraft owns the actionable error state and toast.
    }
  };

  const handleUseLatest = () => {
    if (!selectedEntry) return;
    setDrafts((current) => ({
      ...current,
      [selectedEntry.id]: discardMemoryEntryDraft(selectedEntry),
    }));
  };

  const handleDeleteCurrent = () => {
    if (!selectedEntry || !canDeleteMemoryEntry(selectedEntry)) return;
    setEntryToDelete(selectedEntry);
  };

  const handleDeleteEntry = async () => {
    if (!entryToDelete || !canDeleteMemoryEntry(entryToDelete)) return;
    const affectedEntries = memoryEntrySubtree(entries, entryToDelete.id);
    const affectedIds = new Set(affectedEntries.map((entry) => entry.id));
    try {
      await deleteEntry.mutateAsync({
        entryId: entryToDelete.id,
        expectedVersion: entryToDelete.version,
        recursive: entryToDelete.type === "directory",
      });

      setDrafts((current) => {
        const next = { ...current };
        for (const entryId of affectedIds) delete next[entryId];
        return next;
      });
      setExpandedNodeIds((current) => {
        const next = new Set(current);
        for (const entryId of affectedIds) next.delete(entryId);
        return next;
      });
      if (focusedNodeId && affectedIds.has(focusedNodeId)) {
        setFocusedNodeId(null);
      }

      const selectedWasDeleted = Boolean(
        selectedEntryId && affectedIds.has(selectedEntryId),
      );
      const refreshed = await refreshWorkspace();
      if (selectedWasDeleted) {
        const nextEntryId = refreshed.isError
          ? null
          : resolveMemoryWorkspaceFileId(
              refreshed.data?.entries ?? EMPTY_ENTRIES,
              null,
            );
        onSearchChange({ entryId: nextEntryId, path: null }, { replace: true });
      }
      setEntryToDelete(null);
      toast.success(
        entryToDelete.type === "directory"
          ? "Directory deleted."
          : "Memory file deleted.",
      );
    } catch (error) {
      toast.error(
        entryToDelete.type === "directory"
          ? "Failed to delete directory."
          : "Failed to delete memory file.",
        {
          description: memoryEntryErrorMessage(error),
        },
      );
    }
  };

  const handleRelocateEntry = async ({
    source,
    destinationParentId,
    name,
    operation,
  }: {
    source: PyMemoryEntryHeader;
    destinationParentId?: string | null;
    name?: string;
    operation: "move" | "rename";
  }) => {
    if (moveEntry.isPending || moveReconciliationRef.current) return false;
    if (operation === "move") {
      const destination = destinationParentId
        ? (entries.find((entry) => entry.id === destinationParentId) ?? null)
        : null;
      const validation = validateMemoryMoveDestination({
        source,
        destination,
        entries,
      });
      if (!validation.valid) {
        toast.error("Cannot move memory entry.", {
          description: validation.reason ?? undefined,
        });
        return false;
      }
    } else if (!name || !canMoveMemoryEntry(source)) {
      toast.error("This memory entry cannot be renamed.");
      return false;
    } else if (name === source.name) {
      return true;
    }

    const affectedEntries = memoryEntrySubtree(entries, source.id);
    if (affectedEntries.length === 0) return false;
    moveReconciliationRef.current = new Set(
      affectedEntries.map((entry) => entry.id),
    );
    setMovingEntryId(source.id);

    try {
      const moved = await moveEntry.mutateAsync({
        source,
        destinationParentId,
        name,
        affectedEntries,
      });
      const selectedBefore = selectedEntryId
        ? affectedEntries.find((entry) => entry.id === selectedEntryId)
        : null;
      const selectedNextPath =
        search.path && selectedBefore
          ? projectMemoryMovePath(selectedBefore.path, source.path, moved.path)
          : null;
      const refreshed = await refreshWorkspace();

      if (refreshed.data && !refreshed.isError) {
        setDrafts((current) =>
          rebaseMemoryEntryDraftsAfterMove({
            drafts: current,
            beforeEntries: affectedEntries,
            refreshedEntries: refreshed.data.entries ?? EMPTY_ENTRIES,
            oldRootPath: source.path,
            newRootPath: moved.path,
          }),
        );
        if (selectedNextPath) {
          onSearchChange(
            { entryId: null, path: selectedNextPath },
            { replace: true },
          );
        }
        toast.success(
          operation === "rename"
            ? `${source.name} renamed to ${moved.name}.`
            : `${source.name} moved.`,
        );
      } else {
        toast.warning(
          `Memory ${operation} succeeded, but the explorer could not refresh.`,
          {
            description: "Refresh before making another change.",
          },
        );
      }
      if (operation === "move" && destinationParentId) {
        setExpandedNodeIds(
          (current) => new Set([...current, destinationParentId]),
        );
      }
      if (operation === "move") setMoveSource(null);
      else setRenameSource(null);
      return true;
    } catch (error) {
      if (isMemoryEntryConflict(error)) {
        toast.error("This memory changed elsewhere.", {
          description: `The explorer was not ${operation === "rename" ? "renamed" : "moved"}. Refresh and try again.`,
        });
      } else if (error instanceof MemoryEntryApiError) {
        toast.error(`Failed to ${operation} memory entry.`, {
          description: memoryEntryErrorMessage(error),
        });
      } else {
        toast.error(`The ${operation} result is uncertain.`, {
          description: `Refreshing before another ${operation} is attempted.`,
        });
        const refreshed = await refreshWorkspace();
        const refreshedSource = refreshed.isError
          ? null
          : refreshed.data?.entries?.find((entry) => entry.id === source.id);
        if (operation === "move") setMoveSource(refreshedSource ?? null);
        else setRenameSource(refreshedSource ?? null);
      }
      return false;
    } finally {
      moveReconciliationRef.current = null;
      setMovingEntryId(null);
    }
  };

  const handleMoveEntry = (
    source: PyMemoryEntryHeader,
    destinationParentId: string | null,
  ) =>
    handleRelocateEntry({
      source,
      destinationParentId,
      operation: "move",
    });

  const handleRenameEntry = (source: PyMemoryEntryHeader, name: string) =>
    handleRelocateEntry({ source, name, operation: "rename" });

  const handleEntrySelect = (entry: PyMemoryEntryHeader) => {
    setFocusedNodeId(entry.id);
    setMobilePane("preview");
    onSearchChange(
      {
        entryId: entry.id,
        path: null,
        mode: modeForMemoryEntrySelection(
          search.mode,
          isEpisodeLogEntry(entry),
        ),
      },
      { replace: true },
    );
  };

  const handleModeChange = (mode: MemoryWorkspaceMode) => {
    setMobilePane("work");
    onSearchChange({ mode }, { replace: false });
  };

  const handleNodeToggle = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const openCreateDialog = (
    kind: CreateMemoryEntryKind,
    parentId?: string | null,
  ) => {
    if (parentId === undefined && creationTarget.disabled) {
      toast.error(
        focusedNode?.kind === "episode-root" ||
          focusedNode?.kind === "episode-month" ||
          focusedNode?.kind === "episode-file"
          ? "Generated episodes cannot contain user-created files."
          : focusedNode?.kind === "anima-root" ||
              focusedNode?.kind === "anima-directory" ||
              (focusedNode &&
                "entry" in focusedNode &&
                focusedNode.entry.anima_id)
            ? "Anima folders only contain each Anima's identity and memories."
            : "The animas path is reserved for Anima identities.",
      );
      return;
    }
    setCreateKind(kind);
    setCreateParentId(
      parentId === undefined ? creationTarget.parentId : parentId,
    );
    setCreateOpen(true);
  };

  /** Recreates a missing `MEMORIES.md`; the refreshed listing shows it. */
  const handleRepairAnimaMemories = async (animaId: string) => {
    const label =
      animaFolders.find((folder) => folder.animaId === animaId)?.label ??
      "This Anima";
    try {
      await repairMemories.mutateAsync({ animaId });
      toast.success(`${label}'s MEMORIES.md was repaired.`);
    } catch (error) {
      toast.error(`Failed to repair ${label}'s MEMORIES.md.`, {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  const handleCreated = (entry: PyMemoryEntryResponse) => {
    if (entry.parent_id) {
      setExpandedNodeIds((current) => new Set([...current, entry.parent_id!]));
    }
    if (entry.type === "file") {
      setFocusedNodeId(entry.id);
      onSearchChange({ entryId: entry.id, path: null }, { replace: true });
    }
  };

  const handleSaveAndLeave = async () => {
    setExitSaving(true);
    try {
      await saveMemoryEntryDraftsSequentially(drafts, async (draft) => {
        await saveDraft(draft);
      });
      blocker.proceed?.();
    } catch {
      // Individual save errors keep the blocker and drafts intact.
    } finally {
      setExitSaving(false);
    }
  };

  const previewValue =
    search.mode === "manual" && currentDraft
      ? currentDraft.content
      : (selectedEntry?.content ?? "");
  const previewDescription =
    search.mode === "manual" && currentDraft
      ? currentDraft.description
      : (selectedEntry?.description ?? "");
  const selectedHasDirtyDraft = currentDraft
    ? isMemoryEntryDraftDirty(currentDraft)
    : false;
  const selectedDraftConflict = currentDraft?.conflict === true;
  const deletionDescription = entryToDelete
    ? entryToDelete.type === "file"
      ? `${entryToDelete.path} will be permanently removed.`
      : deletionEntries.length === 1
        ? `${entryToDelete.path} is empty and will be permanently removed.`
        : `${entryToDelete.path} and its contents will be permanently removed. This includes ${deletionFileCount} ${deletionFileCount === 1 ? "file" : "files"}${deletionDirectoryCount > 0 ? ` and ${deletionDirectoryCount} nested ${deletionDirectoryCount === 1 ? "directory" : "directories"}` : ""}.`
    : "";

  const handleReverted = (entry: PyMemoryEntryResponse) => {
    setDrafts((current) => ({
      ...current,
      [entry.id]: commitMemoryEntryDraft(entry),
    }));
  };

  return (
    <AppShellPage
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 p-0"
    >
      {search.tab === "memory" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Tabs
            value={mobilePane}
            onValueChange={(value) =>
              setMobilePane(value as MobileWorkspacePane)
            }
            className="border-border/40 shrink-0 border-b p-2 lg:hidden"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="files">
                <Files className="size-4" /> Files
              </TabsTrigger>
              <TabsTrigger value="work">
                <Pencil className="size-4" /> Work
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye className="size-4" /> Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <MemoryWorkspaceSplitLayout
            explorerCollapsed={explorerCollapsed}
            explorer={
              <section
                aria-label="Memory file explorer"
                className={cn(
                  "bg-background relative min-h-0 min-w-0 flex-1 overflow-hidden lg:flex",
                  mobilePane === "files" ? "flex" : "hidden",
                )}
              >
                <MemoryFileExplorer
                  entries={entries}
                  tree={tree}
                  selectedEntryId={selectedEntryId}
                  focusedNodeId={focusedNodeId}
                  dirtyEntryIds={dirtyEntryIds}
                  pendingEpisodeCount={pendingEpisodeCount}
                  expandedDirectoryIds={expandedNodeIds}
                  collapsed={explorerCollapsed}
                  isLoading={userEntriesQuery.isLoading}
                  isError={userEntriesQuery.isError}
                  controls={{
                    query: treeQuery,
                    isRefreshing: workspaceFetching,
                    creationDisabled: creationTarget.disabled,
                    onQueryChange: setTreeQuery,
                    onRefresh: () => void refreshWorkspace(),
                    onCreateFile: (parentId) =>
                      openCreateDialog("file", parentId),
                    onCreateDirectory: (parentId) =>
                      openCreateDialog("directory", parentId),
                  }}
                  onEntrySelect={handleEntrySelect}
                  onNodeFocus={(node: MemoryWorkspaceTreeNode) =>
                    setFocusedNodeId(node.id)
                  }
                  onDirectoryToggle={handleNodeToggle}
                  onExpandedDirectoryIdsChange={setExpandedNodeIds}
                  onEntryRename={setRenameSource}
                  onEntryDelete={setEntryToDelete}
                  movingEntryId={movingEntryId}
                  onMoveRequest={setMoveSource}
                  onMove={(source, destination) =>
                    void handleMoveEntry(source, destination.id)
                  }
                  onCollapsedChange={setExplorerCollapsed}
                  onRetry={() => void refreshWorkspace()}
                  repairingAnimaId={
                    repairMemories.isPending
                      ? (repairMemories.variables?.animaId ?? null)
                      : null
                  }
                  onRepairAnimaMemories={(animaId) =>
                    void handleRepairAnimaMemories(animaId)
                  }
                />
              </section>
            }
            work={
              <section
                aria-label="Memory work pane"
                className={cn(
                  "bg-background min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex lg:pt-4",
                  mobilePane === "work" ? "flex" : "hidden",
                )}
              >
                <div className="border-border/40 flex min-h-12 shrink-0 items-center border-b px-3 py-2">
                  <Tabs
                    value={search.mode}
                    onValueChange={(value) =>
                      handleModeChange(value as MemoryWorkspaceMode)
                    }
                    className="min-w-0 flex-1"
                  >
                    <TabsList className="bg-muted grid w-full grid-cols-2">
                      <TabsTrigger value="manual">Manual</TabsTrigger>
                      <TabsTrigger value="manager">Memory Manager</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {search.mode === "manual" ? (
                    <MemoryManualPanel
                      entry={selectedEntry}
                      draft={currentDraft}
                      isLoading={selectedLoading}
                      isError={selectedError}
                      isSaving={patchEntry.isPending}
                      isDeleting={deleteEntry.isPending}
                      onContentChange={(content) => updateDraft({ content })}
                      onDescriptionChange={(description) =>
                        updateDraft({ description })
                      }
                      onSave={(force) => void handleSaveCurrent(force)}
                      onUseLatest={handleUseLatest}
                      onDiscard={handleUseLatest}
                      onDelete={() => void handleDeleteCurrent()}
                      onOpenManager={() => handleModeChange("manager")}
                    />
                  ) : (
                    <MemoryManagerPanel
                      controller={manager}
                      pendingEpisodeCount={pendingEpisodeCount}
                    />
                  )}
                </div>
              </section>
            }
            preview={
              <section
                aria-label="Memory preview"
                className={cn(
                  "bg-background min-h-0 min-w-0 flex-1 overflow-hidden lg:flex lg:pt-4",
                  mobilePane === "preview" ? "flex" : "hidden",
                )}
              >
                <MemoryWorkspacePreview
                  entry={selectedEntry}
                  displayPath={
                    selectedEntry
                      ? workspacePathById.get(selectedEntry.id)
                      : undefined
                  }
                  value={previewValue}
                  description={previewDescription}
                  isLoading={selectedLoading}
                  isError={selectedError}
                  hasUnsavedDraft={selectedHasDirtyDraft}
                  onOpenVersions={() => setVersionsOpen(true)}
                  unsavedLabel={
                    search.mode === "manager"
                      ? "Unsaved manual draft"
                      : "Unsaved draft"
                  }
                />
              </section>
            }
          />
        </div>
      ) : null}

      <MemoryCreateEntryDialog
        open={createOpen}
        kind={createKind}
        parentId={createParentId}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <MemoryRenameEntryDialog
        entry={renameSource}
        open={renameSource !== null}
        isRenaming={moveEntry.isPending && movingEntryId === renameSource?.id}
        onOpenChange={(open) => !open && setRenameSource(null)}
        onConfirm={(name) =>
          renameSource
            ? handleRenameEntry(renameSource, name)
            : Promise.resolve(false)
        }
      />

      <MemoryMoveEntryDialog
        source={moveSource}
        entries={entries}
        open={moveSource !== null}
        isMoving={movingEntryId !== null}
        onOpenChange={(open) => !open && setMoveSource(null)}
        onConfirm={(destinationParentId) => {
          if (moveSource) {
            void handleMoveEntry(moveSource, destinationParentId);
          }
        }}
      />

      <MemoryVersionsDialog
        entry={selectedEntry}
        open={versionsOpen && selectedEntry !== null}
        draftDirty={selectedHasDirtyDraft}
        draftConflict={selectedDraftConflict}
        onOpenChange={setVersionsOpen}
        onDiscardDraft={handleUseLatest}
        onReverted={handleReverted}
      />

      <Dialog
        open={entryToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteEntry.isPending) setEntryToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete{" "}
              {entryToDelete?.type === "directory" ? "directory" : "file"}?
            </DialogTitle>
            <DialogDescription>{deletionDescription}</DialogDescription>
          </DialogHeader>
          {deletionDirtyDraftCount > 0 ? (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {deletionDirtyDraftCount} unsaved
                {deletionDirtyDraftCount === 1 ? " draft" : " drafts"} will also
                be discarded.
              </span>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteEntry.isPending}
              onClick={() => setEntryToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteEntry.isPending}
              onClick={() => void handleDeleteEntry()}
            >
              {deleteEntry.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved memory drafts</DialogTitle>
            <DialogDescription>
              Save or discard {dirtyDrafts.length} unsaved
              {dirtyDrafts.length === 1 ? " draft" : " drafts"} before leaving
              the Memory workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Stay
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDrafts({});
                  blocker.proceed?.();
                }}
              >
                Discard and leave
              </Button>
              <Button
                disabled={exitSaving}
                onClick={() => void handleSaveAndLeave()}
              >
                {exitSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save and leave
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShellPage>
  );
}
