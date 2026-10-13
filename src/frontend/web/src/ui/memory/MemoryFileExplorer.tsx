"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  EllipsisVertical,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoveRight,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { useElementSize } from "@/hooks/useElementSize";
import { isReservedUserMemoryEntry } from "@/lib/memory-entries/anima-folders";
import {
  memoryExplorerProtectedRowActions,
  memoryExplorerRowActions,
  type MemoryExplorerAction,
  type MemoryExplorerActionId,
} from "@/lib/memory-entries/explorer-actions";
import {
  canMoveMemoryEntry,
  validateMemoryMoveDestination,
} from "@/lib/memory-entries/workspace-moves";
import {
  buildMemoryWorkspaceTree,
  expandableMemoryWorkspaceNodeIds,
  filterMemoryWorkspaceTree,
  type MemoryWorkspaceTreeNode,
} from "@/lib/memory-entries/workspace-tree";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import { Input } from "@/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

export type MemoryFileExplorerControls = {
  query: string;
  isRefreshing: boolean;
  creationDisabled: boolean;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onCreateFile: (parentId?: string | null) => void;
  onCreateDirectory: (parentId?: string | null) => void;
};

type MemoryFileExplorerProps = {
  entries: PyMemoryEntryHeader[];
  tree?: MemoryWorkspaceTreeNode[];
  selectedEntryId: string | null;
  focusedNodeId?: string | null;
  dirtyEntryIds?: Set<string>;
  expandedDirectoryIds: Set<string>;
  pendingEpisodeCount: number;
  collapsed: boolean;
  isLoading: boolean;
  isError: boolean;
  controls?: MemoryFileExplorerControls;
  onEntrySelect: (entry: PyMemoryEntryHeader) => void;
  onNodeFocus?: (node: MemoryWorkspaceTreeNode) => void;
  onDirectoryToggle: (entryId: string) => void;
  onExpandedDirectoryIdsChange: (entryIds: Set<string>) => void;
  onEntryRename: (entry: PyMemoryEntryHeader) => void;
  onEntryDelete: (entry: PyMemoryEntryHeader) => void;
  movingEntryId?: string | null;
  onMoveRequest?: (entry: PyMemoryEntryHeader) => void;
  onMove?: (
    source: PyMemoryEntryHeader,
    destination: PyMemoryEntryHeader,
  ) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onRetry: () => void;
  /** Anima whose `MEMORIES.md` repair is in flight. */
  repairingAnimaId?: string | null;
  /** Recreates an Anima's missing `MEMORIES.md` from its template. */
  onRepairAnimaMemories?: (animaId: string) => void;
};

const memoryExplorerCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

function pendingCountLabel(count: number) {
  return count > 99 ? "99+" : String(count);
}

function ExplorerActionIcon({ id }: { id: MemoryExplorerActionId }) {
  if (id === "new-file") return <FilePlus2 className="mr-2 size-4" />;
  if (id === "new-directory") return <FolderPlus className="mr-2 size-4" />;
  if (id === "rename") return <Pencil className="mr-2 size-4" />;
  if (id === "move") return <MoveRight className="mr-2 size-4" />;
  return <Trash2 className="mr-2 size-4" />;
}

function ExplorerDropdownActions({
  actions,
  onAction,
}: {
  actions: MemoryExplorerAction[];
  onAction: (id: MemoryExplorerActionId) => void;
}) {
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        disabled={action.disabled}
        className={cn(
          action.destructive &&
            !action.disabled &&
            "text-destructive focus:text-destructive",
        )}
        onSelect={() => !action.disabled && onAction(action.id)}
      >
        <ExplorerActionIcon id={action.id} /> {action.label}
      </DropdownMenuItem>
    </Fragment>
  ));
}

function ExplorerContextActions({
  actions,
  onAction,
}: {
  actions: MemoryExplorerAction[];
  onAction: (id: MemoryExplorerActionId) => void;
}) {
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separatorBefore ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        disabled={action.disabled}
        className={cn(
          action.destructive &&
            !action.disabled &&
            "text-destructive focus:text-destructive",
        )}
        onSelect={() => !action.disabled && onAction(action.id)}
      >
        <ExplorerActionIcon id={action.id} /> {action.label}
      </ContextMenuItem>
    </Fragment>
  ));
}

/** Indents an Anima folder's missing-file notice like one of its rows. */
function missingFileNoticeClass(compact: boolean) {
  return cn(
    "text-muted-foreground border-border/60 border-l py-2 text-xs",
    compact ? "ml-1 px-1.5" : "ml-3 px-3",
  );
}

function memoryExplorerDirectoryIds(nodes: MemoryWorkspaceTreeNode[]) {
  const ids: string[] = [];
  const visit = (node: MemoryWorkspaceTreeNode) => {
    if (node.kind !== "file" && node.kind !== "episode-file") {
      ids.push(node.id);
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return ids;
}

function NodeIcon({
  node,
  expanded,
}: {
  node: MemoryWorkspaceTreeNode;
  expanded: boolean;
}) {
  if (node.kind === "anima-root") {
    return (
      <Users className="size-4 shrink-0 text-rose-600 dark:text-rose-400" />
    );
  }
  if (node.kind === "anima-directory") {
    return (
      <UserRound className="size-4 shrink-0 text-rose-600 dark:text-rose-400" />
    );
  }
  if (node.kind === "episode-root") {
    return (
      <CalendarDays className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
    );
  }
  if (node.kind === "episode-month") {
    return (
      <CalendarRange className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
    );
  }
  if (node.kind === "directory") {
    return expanded ? (
      <FolderOpen className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
    ) : (
      <Folder className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
    );
  }
  return (
    <FileText className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
  );
}

function ExplorerRow({
  node,
  entries,
  compact,
  selectedEntryId,
  focusedNodeId,
  dirtyEntryIds,
  pendingEpisodeCount,
  expandedDirectoryIds,
  draggingEntryId,
  movingEntryId,
  onEntrySelect,
  onNodeFocus,
  onDirectoryToggle,
  onCreateFile,
  onCreateDirectory,
  onEntryRename,
  onEntryDelete,
  onMoveRequest,
  repairingAnimaId,
  onRepairAnimaMemories,
}: {
  node: MemoryWorkspaceTreeNode;
  entries: PyMemoryEntryHeader[];
  compact: boolean;
  selectedEntryId: string | null;
  focusedNodeId: string | null;
  dirtyEntryIds: Set<string>;
  pendingEpisodeCount: number;
  expandedDirectoryIds: Set<string>;
  draggingEntryId: string | null;
  movingEntryId: string | null;
  onEntrySelect: (entry: PyMemoryEntryHeader) => void;
  onNodeFocus?: (node: MemoryWorkspaceTreeNode) => void;
  onDirectoryToggle: (entryId: string) => void;
  onCreateFile?: (parentId?: string | null) => void;
  onCreateDirectory?: (parentId?: string | null) => void;
  onEntryRename: (entry: PyMemoryEntryHeader) => void;
  onEntryDelete: (entry: PyMemoryEntryHeader) => void;
  onMoveRequest?: (entry: PyMemoryEntryHeader) => void;
  repairingAnimaId: string | null;
  onRepairAnimaMemories?: (animaId: string) => void;
}) {
  const { t } = useTranslation("memory");
  // The virtual Episodes root is the only fixed label; everything else is a
  // stored name, an Anima name or a formatted date.
  const label =
    node.kind === "episode-root" ? t("explorer.episodesRoot") : node.label;
  const expandable =
    node.children.length > 0 ||
    (node.kind !== "file" && node.kind !== "episode-file");
  const expanded = expandable && expandedDirectoryIds.has(node.id);
  const entry = "entry" in node ? node.entry : null;
  const isFile = node.kind === "file" || node.kind === "episode-file";
  const selected = isFile && entry?.id === selectedEntryId;
  const focused = node.id === focusedNodeId;
  const dirty = entry ? dirtyEntryIds.has(entry.id) : false;
  const path =
    (node.kind === "file" ? node.displayPath : undefined) ??
    entry?.path ??
    label;
  // Flag the pre-existing root entry occupying the reserved `animas` name.
  const reservedConflict = Boolean(
    entry && !entry.parent_id && isReservedUserMemoryEntry(entry),
  );
  const repairNeeded =
    node.kind === "anima-directory" &&
    (node.identityMissing || node.memoriesMissing);
  const moveable = Boolean(entry && canMoveMemoryEntry(entry));
  const actions = (
    entry
      ? memoryExplorerRowActions(entry)
      : node.kind === "episode-root" ||
          node.kind === "episode-month" ||
          node.kind === "anima-root" ||
          node.kind === "anima-directory"
        ? memoryExplorerProtectedRowActions("directory")
        : []
  ).filter((action) => {
    if (action.id === "new-file") return Boolean(onCreateFile);
    if (action.id === "new-directory") return Boolean(onCreateDirectory);
    if (action.id === "move") return Boolean(onMoveRequest);
    return true;
  });
  const hasActions = actions.length > 0;
  const activeSource = entries.find(
    (candidate) => candidate.id === draggingEntryId,
  );
  const validDropTarget = Boolean(
    activeSource &&
    entry &&
    node.kind === "directory" &&
    validateMemoryMoveDestination({
      source: activeSource,
      destination: entry,
      entries,
    }).valid,
  );
  const {
    attributes: draggableAttributes,
    listeners: draggableListeners,
    setActivatorNodeRef,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: node.id,
    data: entry ? { entry } : undefined,
    disabled: !moveable || Boolean(movingEntryId),
  });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: node.id,
    data: entry ? { entry } : undefined,
    disabled: !validDropTarget || Boolean(movingEntryId),
  });
  const setRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      setDraggableNodeRef(element);
      setDroppableNodeRef(element);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );

  const handleOpen = () => {
    onNodeFocus?.(node);
    if (isFile && entry) onEntrySelect(entry);
    else onDirectoryToggle(node.id);
  };

  const handleAction = (action: MemoryExplorerActionId) => {
    if (actions.find((candidate) => candidate.id === action)?.disabled) return;
    if (!entry) return;
    onNodeFocus?.(node);
    if (action === "new-file") onCreateFile?.(entry.id);
    else if (action === "new-directory") onCreateDirectory?.(entry.id);
    else if (action === "rename") onEntryRename(entry);
    else if (action === "move") onMoveRequest?.(entry);
    else onEntryDelete(entry);
  };

  const row = (
    <div
      ref={setRowRef}
      onContextMenu={(event) => {
        event.stopPropagation();
        onNodeFocus?.(node);
        if (!hasActions) event.preventDefault();
      }}
      className={cn(
        "group/tree-row relative flex w-full max-w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-sm",
        selected &&
          "bg-sky-500/10 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-sky-500",
        isOver && validDropTarget && "bg-primary/10 ring-primary/60 ring-1",
        isDragging && "opacity-40",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        title={path}
        aria-expanded={expandable ? expanded : undefined}
        aria-current={selected ? "page" : undefined}
        onClick={handleOpen}
        {...(moveable ? draggableAttributes : {})}
        {...(moveable ? draggableListeners : {})}
        className={cn(
          "focus-visible:ring-ring flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 text-left text-sm outline-none focus-visible:ring-2",
          selected
            ? "text-foreground"
            : focused
              ? "bg-muted/70 text-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground group-hover/tree-row:bg-muted/70 group-hover/tree-row:text-foreground",
          compact && hasActions && "pr-7",
        )}
      >
        {expandable ? (
          expanded ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        {entry?.id === movingEntryId ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : (
          <NodeIcon node={node} expanded={expanded} />
        )}
        <span className="min-w-0 flex-1 py-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">{label}</span>
            {dirty ? (
              <span
                className="bg-warning size-1.5 shrink-0 rounded-full"
                title={t("explorer.unsavedChanges")}
              />
            ) : null}
            {reservedConflict ? (
              <span className="shrink-0" title={t("explorer.reservedNameHint")}>
                <AlertTriangle aria-hidden className="text-warning size-3.5" />
                <span className="sr-only">{t("explorer.reservedName")}</span>
              </span>
            ) : null}
            {repairNeeded ? (
              <span className="shrink-0" title={t("explorer.needsRepair")}>
                <AlertTriangle aria-hidden className="text-warning size-3.5" />
                <span className="sr-only">{t("explorer.needsRepair")}</span>
              </span>
            ) : null}
          </span>
          {node.kind === "episode-file" ? (
            <span className="text-muted-foreground text-2xs block truncate leading-3">
              {node.entry.path}
            </span>
          ) : null}
        </span>
        {node.kind === "episode-root" && pendingEpisodeCount > 0 ? (
          <span
            aria-label={t("explorer.pendingEpisodes", {
              count: pendingEpisodeCount,
            })}
            className="bg-primary text-primary-foreground text-2xs ml-auto shrink-0 rounded-full px-1.5 py-0.5 leading-none"
            title={t("explorer.pendingEpisodes", {
              count: pendingEpisodeCount,
            })}
          >
            {pendingCountLabel(pendingEpisodeCount)}
          </span>
        ) : null}
      </button>
      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "absolute top-1/2 right-1 z-10 size-6 -translate-y-1/2 bg-transparent shadow-none",
                compact
                  ? "opacity-0 group-hover/tree-row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  : "opacity-100 md:opacity-0 md:group-hover/tree-row:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100",
              )}
              aria-label={t("explorer.actionsFor", { path })}
            >
              <EllipsisVertical className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <ExplorerDropdownActions
              actions={actions}
              onAction={handleAction}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <li className="max-w-full min-w-0">
      {hasActions ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ExplorerContextActions actions={actions} onAction={handleAction} />
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {expanded && node.kind === "anima-directory" && node.identityMissing ? (
        <p className={missingFileNoticeClass(compact)}>
          {t("explorer.identityMissing")}
        </p>
      ) : null}
      {expanded && node.children.length > 0 ? (
        <ul
          className={cn(
            "border-border/60 box-border min-w-0 border-l",
            compact
              ? "ml-1 w-[calc(100%_-_0.25rem)] pl-0.5"
              : "ml-3 w-[calc(100%_-_0.75rem)] pl-1",
          )}
        >
          {node.children.map((child) => (
            <ExplorerRow
              key={child.id}
              node={child}
              entries={entries}
              compact={compact}
              selectedEntryId={selectedEntryId}
              focusedNodeId={focusedNodeId}
              dirtyEntryIds={dirtyEntryIds}
              pendingEpisodeCount={pendingEpisodeCount}
              expandedDirectoryIds={expandedDirectoryIds}
              draggingEntryId={draggingEntryId}
              movingEntryId={movingEntryId}
              onEntrySelect={onEntrySelect}
              onNodeFocus={onNodeFocus}
              onDirectoryToggle={onDirectoryToggle}
              onCreateFile={onCreateFile}
              onCreateDirectory={onCreateDirectory}
              onEntryRename={onEntryRename}
              onEntryDelete={onEntryDelete}
              onMoveRequest={onMoveRequest}
              repairingAnimaId={repairingAnimaId}
              onRepairAnimaMemories={onRepairAnimaMemories}
            />
          ))}
        </ul>
      ) : expanded &&
        (node.kind === "episode-root" || node.kind === "anima-root") ? (
        <p className="text-muted-foreground border-border/60 ml-3 border-l px-3 py-2 text-xs">
          {node.kind === "episode-root"
            ? t("explorer.noEpisodes")
            : t("explorer.noAnimas")}
        </p>
      ) : null}
      {expanded && node.kind === "anima-directory" && node.memoriesMissing ? (
        <div
          className={cn(
            missingFileNoticeClass(compact),
            "flex flex-wrap items-center gap-2",
          )}
        >
          <span>{t("explorer.memoriesMissing")}</span>
          {onRepairAnimaMemories ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={Boolean(repairingAnimaId)}
              aria-label={t("explorer.repairMemories", { name: node.label })}
              onClick={() => onRepairAnimaMemories(node.animaId)}
            >
              {repairingAnimaId === node.animaId ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Wrench className="size-3" />
              )}
              {t("explorer.repair")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ExplorerToolbar({
  controls,
  compact,
  allDirectoriesExpanded,
  directoryToggleDisabled,
  onToggleAllDirectories,
  onCollapse,
}: {
  controls: MemoryFileExplorerControls;
  compact: boolean;
  allDirectoriesExpanded: boolean;
  directoryToggleDisabled: boolean;
  onToggleAllDirectories: () => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation("memory");
  const compactButtonClass = compact ? "size-6" : undefined;
  const toolbarIconClass = compact ? "size-3.5" : "size-4";

  return (
    <div
      className={cn(
        "border-border/40 min-w-0 space-y-2 overflow-hidden border-b",
        compact ? "p-1.5" : "p-2",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center justify-center",
          compact ? "gap-0" : "gap-0.5",
        )}
      >
        <div className="flex items-center justify-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={compactButtonClass}
                disabled={controls.creationDisabled}
                onClick={() => controls.onCreateFile()}
              >
                <FilePlus2 className={toolbarIconClass} />
                <span className="sr-only">{t("explorer.newMarkdownFile")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("explorer.newMarkdownFile")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={compactButtonClass}
                disabled={controls.creationDisabled}
                onClick={() => controls.onCreateDirectory()}
              >
                <FolderPlus className={toolbarIconClass} />
                <span className="sr-only">
                  {t("explorer.actions.newDirectory")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("explorer.actions.newDirectory")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={compactButtonClass}
                disabled={directoryToggleDisabled}
                onClick={onToggleAllDirectories}
              >
                {allDirectoriesExpanded ? (
                  <ChevronsDownUp className={toolbarIconClass} />
                ) : (
                  <ChevronsUpDown className={toolbarIconClass} />
                )}
                <span className="sr-only">
                  {allDirectoriesExpanded
                    ? t("explorer.collapseAll")
                    : t("explorer.expandAll")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {allDirectoriesExpanded
                ? t("explorer.collapseAll")
                : t("explorer.expandAll")}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center justify-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={compactButtonClass}
                onClick={controls.onRefresh}
              >
                <RefreshCw
                  className={cn(
                    toolbarIconClass,
                    controls.isRefreshing && "animate-spin",
                  )}
                />
                <span className="sr-only">{t("explorer.refresh")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("explorer.refresh")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn("hidden lg:inline-flex", compactButtonClass)}
                onClick={onCollapse}
              >
                <PanelLeftClose className={toolbarIconClass} />
                <span className="sr-only">{t("explorer.collapse")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("explorer.collapse")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="relative w-full max-w-full min-w-0 overflow-hidden">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={controls.query}
          onChange={(event) => controls.onQueryChange(event.target.value)}
          className="h-8 w-full max-w-full min-w-0 pl-8 text-xs"
          placeholder={
            compact ? t("explorer.filter") : t("explorer.filterFiles")
          }
          aria-label={t("explorer.filterLabel")}
        />
      </div>
    </div>
  );
}

/** Renders physical and virtual memory nodes as an IDE-style explorer. */
export function MemoryFileExplorer({
  entries,
  tree: providedTree,
  selectedEntryId,
  focusedNodeId = null,
  dirtyEntryIds = new Set<string>(),
  pendingEpisodeCount,
  expandedDirectoryIds,
  collapsed,
  isLoading,
  isError,
  controls,
  onEntrySelect,
  onNodeFocus,
  onDirectoryToggle,
  onExpandedDirectoryIdsChange,
  onEntryRename,
  onEntryDelete,
  movingEntryId = null,
  onMoveRequest,
  onMove,
  onCollapsedChange,
  onRetry,
  repairingAnimaId = null,
  onRepairAnimaMemories,
}: MemoryFileExplorerProps) {
  const { t } = useTranslation("memory");
  const { locale } = useFormatters();
  const [explorerElement, setExplorerElement] = useState<HTMLDivElement | null>(
    null,
  );
  const { width: explorerWidth } = useElementSize(explorerElement);
  const compact = explorerWidth > 0 && explorerWidth < 224;
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor),
  );
  const tree = useMemo(
    () => providedTree ?? buildMemoryWorkspaceTree(entries, locale),
    [entries, locale, providedTree],
  );
  const visibleTree = useMemo(
    () => filterMemoryWorkspaceTree(tree, controls?.query ?? ""),
    [controls?.query, tree],
  );
  const directoryIds = useMemo(() => memoryExplorerDirectoryIds(tree), [tree]);
  const allDirectoriesExpanded =
    directoryIds.length > 0 &&
    directoryIds.every((id) => expandedDirectoryIds.has(id));
  const effectiveExpandedIds = useMemo(() => {
    if (!controls?.query.trim()) return expandedDirectoryIds;
    return new Set([
      ...expandedDirectoryIds,
      ...expandableMemoryWorkspaceNodeIds(visibleTree),
    ]);
  }, [controls?.query, expandedDirectoryIds, visibleTree]);
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const handleDragStart = ({ active }: DragStartEvent) => {
    const source = entriesById.get(String(active.id));
    setDraggingEntryId(source && canMoveMemoryEntry(source) ? source.id : null);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingEntryId(null);
    if (!onMove || !over || movingEntryId) return;
    const source = entriesById.get(String(active.id));
    const destination = entriesById.get(String(over.id));
    if (!source || !destination) return;
    if (
      !validateMemoryMoveDestination({ source, destination, entries }).valid
    ) {
      return;
    }
    onMove(source, destination);
  };
  const activeEntry = draggingEntryId
    ? (entriesById.get(draggingEntryId) ?? null)
    : null;
  const accessibility = useMemo(
    () => ({
      screenReaderInstructions: {
        draggable: t("explorer.drag.instructions"),
      },
      announcements: {
        onDragStart({ active }) {
          const source = entriesById.get(String(active.id));
          return source
            ? t("explorer.drag.pickedUp", { path: source.path })
            : undefined;
        },
        onDragOver({ over }) {
          const destination = over ? entriesById.get(String(over.id)) : null;
          return destination
            ? t("explorer.drag.moveInto", { path: destination.path })
            : t("explorer.drag.notOver");
        },
        onDragEnd({ active, over }) {
          const source = entriesById.get(String(active.id));
          const destination = over ? entriesById.get(String(over.id)) : null;
          return source && destination
            ? t("explorer.drag.moving", {
                source: source.path,
                destination: destination.path,
              })
            : t("explorer.drag.cancelled");
        },
        onDragCancel() {
          return t("explorer.drag.cancelled");
        },
      },
    }),
    [entriesById, t],
  ) satisfies {
    screenReaderInstructions: { draggable: string };
    announcements: Announcements;
  };

  return (
    <div
      ref={setExplorerElement}
      className="bg-background flex min-h-0 w-full max-w-full min-w-0 flex-1 overflow-hidden lg:pt-4"
    >
      {collapsed ? (
        <div className="hidden min-h-0 w-full flex-col items-center lg:flex">
          <div className="flex h-12 w-full shrink-0 items-center justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onCollapsedChange(false)}
                >
                  <PanelLeftOpen className="size-4" />
                  <span className="sr-only">{t("explorer.expand")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6} className="z-[150]">
                {t("explorer.expand")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden",
          collapsed ? "flex lg:hidden" : "flex",
        )}
      >
        {controls ? (
          <ExplorerToolbar
            controls={controls}
            compact={compact}
            allDirectoriesExpanded={allDirectoriesExpanded}
            directoryToggleDisabled={directoryIds.length === 0}
            onToggleAllDirectories={() =>
              onExpandedDirectoryIdsChange(
                allDirectoriesExpanded
                  ? new Set<string>()
                  : new Set(directoryIds),
              )
            }
            onCollapse={() => onCollapsedChange(true)}
          />
        ) : (
          <div className="border-border/40 flex h-12 shrink-0 items-center justify-between border-b px-3">
            <p className="text-foreground truncate text-xs font-semibold tracking-wide uppercase">
              {t("explorer.heading")}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden lg:inline-flex"
              onClick={() => onCollapsedChange(true)}
            >
              <PanelLeftClose className="size-4" />
              <span className="sr-only">{t("explorer.collapse")}</span>
            </Button>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={memoryExplorerCollisionDetection}
          accessibility={accessibility}
          onDragStart={handleDragStart}
          onDragCancel={() => setDraggingEntryId(null)}
          onDragEnd={handleDragEnd}
        >
          <ContextMenu>
            <ContextMenuTrigger asChild disabled={!controls}>
              <nav
                aria-label={t("explorer.heading")}
                className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-2"
              >
                {isLoading ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center px-3 text-center text-xs">
                    <Loader2 className="mr-2 size-4 animate-spin" />{" "}
                    {t("explorer.loading")}
                  </div>
                ) : isError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
                    <AlertTriangle className="text-destructive size-6" />
                    <p className="text-muted-foreground text-xs">
                      {t("explorer.loadFailed")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onRetry}
                    >
                      <RefreshCw className="size-4" /> {t("shared.retry")}
                    </Button>
                  </div>
                ) : visibleTree.length === 0 ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center px-3 text-center text-xs">
                    {controls?.query.trim()
                      ? t("explorer.noMatches")
                      : t("explorer.empty")}
                  </div>
                ) : (
                  <ul className="max-w-full min-w-0">
                    {visibleTree.map((node) => (
                      <ExplorerRow
                        key={node.id}
                        node={node}
                        entries={entries}
                        compact={compact}
                        selectedEntryId={selectedEntryId}
                        focusedNodeId={focusedNodeId}
                        dirtyEntryIds={dirtyEntryIds}
                        pendingEpisodeCount={pendingEpisodeCount}
                        expandedDirectoryIds={effectiveExpandedIds}
                        draggingEntryId={draggingEntryId}
                        movingEntryId={movingEntryId}
                        onEntrySelect={onEntrySelect}
                        onNodeFocus={onNodeFocus}
                        onDirectoryToggle={onDirectoryToggle}
                        onCreateFile={controls?.onCreateFile}
                        onCreateDirectory={controls?.onCreateDirectory}
                        onEntryRename={onEntryRename}
                        onEntryDelete={onEntryDelete}
                        onMoveRequest={onMoveRequest}
                        repairingAnimaId={repairingAnimaId}
                        onRepairAnimaMemories={onRepairAnimaMemories}
                      />
                    ))}
                  </ul>
                )}
              </nav>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => controls?.onCreateFile(null)}>
                <FilePlus2 className="mr-2 size-4" />{" "}
                {t("explorer.actions.newFile")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => controls?.onCreateDirectory(null)}
              >
                <FolderPlus className="mr-2 size-4" />{" "}
                {t("explorer.actions.newDirectory")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <DragOverlay>
            {activeEntry ? (
              <div className="bg-popover text-popover-foreground border-border flex max-w-72 items-center gap-2 rounded-sm border px-3 py-2 text-sm shadow-lg">
                {activeEntry.type === "directory" ? (
                  <Folder className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <FileText className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
                )}
                <span className="min-w-0">
                  <span className="block truncate">{activeEntry.name}</span>
                  <span className="text-muted-foreground text-2xs block truncate">
                    {activeEntry.path}
                  </span>
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
