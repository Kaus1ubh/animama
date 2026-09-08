"use client";

import {
  ArrowLeft,
  ChevronRight,
  FileClock,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  PyMemoryEntryResponse,
  PyMemoryEntryVersionFieldChange,
} from "@/lib/content/catalogTypes";
import {
  isMemoryEntryConflict,
  memoryEntryErrorMessage,
} from "@/lib/memory-entries/errors";
import {
  memoryEntryRevertAction,
  memoryEntryRevertComparison,
} from "@/lib/memory-entries/revert-workflow";
import {
  flattenMemoryEntryVersionPages,
  memoryVersionOperationLabel,
  memoryVersionSubtitle,
  memoryVersionTitle,
} from "@/lib/memory-entries/version-history";
import {
  useMemoryEntryVersion,
  useMemoryEntryVersions,
} from "@/query/hooks/useMemoryEntries";
import { useRevertMemoryEntry } from "@/query/mutations/useRevertMemoryEntry";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { MemoryUnifiedDiff } from "@/ui/memory/MemoryDiffViewer";

function formatVersionTime(value: string | null | undefined) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function VersionFieldChange({
  label,
  change,
}: {
  label: string;
  change: PyMemoryEntryVersionFieldChange;
}) {
  return (
    <div className="border-border/70 bg-muted/20 rounded-md border p-3">
      <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </p>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <code className="bg-background min-w-0 rounded px-2 py-1 break-words">
          {change.old || "None"}
        </code>
        <span className="text-muted-foreground hidden sm:inline">→</span>
        <code className="bg-background min-w-0 rounded px-2 py-1 break-words">
          {change.new || "None"}
        </code>
      </div>
    </div>
  );
}

/** Displays read-only, adjacent changes for one memory entry's versions. */
export function MemoryVersionsDialog({
  entry,
  open,
  draftDirty,
  draftConflict,
  onOpenChange,
  onDiscardDraft,
  onReverted,
}: {
  entry: PyMemoryEntryResponse | null;
  open: boolean;
  draftDirty: boolean;
  draftConflict: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscardDraft: () => void;
  onReverted: (entry: PyMemoryEntryResponse) => void;
}) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const revertEntry = useRevertMemoryEntry();
  const versionsQuery = useMemoryEntryVersions(entry?.id, {
    enabled: open && Boolean(entry),
  });
  const versions = useMemo(
    () => flattenMemoryEntryVersionPages(versionsQuery.data?.pages),
    [versionsQuery.data?.pages],
  );
  const detailQuery = useMemoryEntryVersion(entry?.id, selectedVersion, {
    enabled: open && selectedVersion !== null,
  });
  const detail = detailQuery.data;
  const revertAction = memoryEntryRevertAction({
    entry,
    targetVersion: selectedVersion,
    draftDirty,
    draftConflict,
  });
  const comparison =
    entry && detail ? memoryEntryRevertComparison(entry, detail) : null;

  useEffect(() => {
    if (!open || !entry) return;
    setSelectedVersion(entry.version);
    setMobileView("list");
    setDiscardPromptOpen(false);
    setConfirmVersion(null);
  }, [entry, open]);

  const selectVersion = (version: number) => {
    setSelectedVersion(version);
    setMobileView("detail");
    setDiscardPromptOpen(false);
    setConfirmVersion(null);
  };

  const requestRevert = () => {
    if (!selectedVersion || !comparison?.hasChanges) return;
    if (revertAction === "discard") {
      setDiscardPromptOpen(true);
      return;
    }
    if (revertAction === "confirm") setConfirmVersion(selectedVersion);
  };

  const discardAndContinue = () => {
    if (!selectedVersion) return;
    onDiscardDraft();
    setDiscardPromptOpen(false);
    setConfirmVersion(selectedVersion);
  };

  const confirmRevert = async () => {
    if (!entry || !confirmVersion) return;
    try {
      const updated = await revertEntry.mutateAsync({
        entryId: entry.id,
        body: {
          target_version: confirmVersion,
          expected_version: entry.version,
          expected_aggregate_revision: entry.aggregate_revision,
        },
      });
      setConfirmVersion(null);
      setSelectedVersion(updated.version);
      onReverted(updated);
      toast.success(`Reverted to Version ${confirmVersion}.`, {
        description: `The restored content is now Version ${updated.version}.`,
      });
    } catch (error) {
      if (isMemoryEntryConflict(error)) {
        setConfirmVersion(null);
        toast.error("This memory changed before Revert could finish.", {
          description:
            "Current memory and Versions were refreshed. Your newer draft was preserved.",
        });
        return;
      }
      toast.error("Failed to revert memory.", {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(88vh,52rem)] w-[min(96vw,72rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="border-border/70 shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2">
              <FileClock className="size-5" /> Versions
            </DialogTitle>
            <DialogDescription className="truncate">
              {entry?.path ?? "Memory entry"} · Current Version{" "}
              {entry?.version ?? "—"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 sm:grid-cols-[18rem_minmax(0,1fr)]">
            <section
              aria-label="Memory entry versions"
              className={`border-border/70 min-h-0 flex-col overflow-hidden border-r ${
                mobileView === "list" ? "flex" : "hidden sm:flex"
              }`}
            >
              <div className="text-muted-foreground border-border/70 border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
                Version history
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {versionsQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center justify-center p-6 text-sm">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Loading
                    versions...
                  </div>
                ) : versionsQuery.isError ? (
                  <div className="text-destructive space-y-3 p-4 text-sm">
                    <p>Failed to load version history.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void versionsQuery.refetch()}
                    >
                      <RefreshCw className="size-4" /> Retry
                    </Button>
                  </div>
                ) : versions.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-sm">
                    No versions are available.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {versions.map((version) => {
                      const selected = version.version === selectedVersion;
                      return (
                        <button
                          key={version.version}
                          type="button"
                          onClick={() => selectVersion(version.version)}
                          className={`hover:bg-muted/60 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors ${
                            selected ? "bg-muted" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-foreground text-sm font-medium">
                                Version {version.version}
                              </span>
                              {version.version === entry?.version ? (
                                <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                  Current
                                </span>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {memoryVersionOperationLabel(version.operation)} ·{" "}
                              {formatVersionTime(version.created_at)}
                            </p>
                          </div>
                          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {versionsQuery.hasNextPage ? (
                <div className="border-border/70 shrink-0 border-t p-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={versionsQuery.isFetchingNextPage}
                    onClick={() => void versionsQuery.fetchNextPage()}
                  >
                    {versionsQuery.isFetchingNextPage ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Load older versions
                  </Button>
                </div>
              ) : null}
            </section>

            <section
              aria-label="Selected version changes"
              className={`min-h-0 flex-col overflow-hidden ${
                mobileView === "detail" ? "flex" : "hidden sm:flex"
              }`}
            >
              <div className="border-border/70 flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="sm:hidden"
                  onClick={() => setMobileView("list")}
                >
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <div className="min-w-0">
                  <h3 className="text-foreground truncate text-sm font-semibold">
                    {selectedVersion
                      ? memoryVersionTitle(selectedVersion)
                      : "Select a version"}
                  </h3>
                  {selectedVersion ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {memoryVersionSubtitle(selectedVersion)}
                    </p>
                  ) : null}
                </div>
                {revertAction !== "hidden" && comparison?.hasChanges ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={revertEntry.isPending}
                    onClick={requestRevert}
                  >
                    {revertEntry.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    Revert to Version {selectedVersion}
                  </Button>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                {!selectedVersion ? (
                  <p className="text-muted-foreground text-sm">
                    Select a version to inspect its changes.
                  </p>
                ) : detailQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Loading
                    changes...
                  </div>
                ) : detailQuery.isError || !detail ? (
                  <div className="text-destructive space-y-3 p-4 text-sm">
                    <p>Failed to load this version.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void detailQuery.refetch()}
                    >
                      <RefreshCw className="size-4" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {discardPromptOpen ? (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                        <p className="text-foreground text-sm font-semibold">
                          Discard the Manual draft first?
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          Revert cannot continue while this file has an unsaved
                          or conflicted draft. Discarding restores the current
                          server content before you review the final
                          confirmation.
                        </p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDiscardPromptOpen(false)}
                          >
                            Keep draft
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={discardAndContinue}
                          >
                            Discard draft and continue
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {detail.path_change || detail.description_change ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {detail.path_change ? (
                          <VersionFieldChange
                            label="Path"
                            change={detail.path_change}
                          />
                        ) : null}
                        {detail.description_change ? (
                          <VersionFieldChange
                            label="Description"
                            change={detail.description_change}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="border-border/70 bg-background overflow-hidden rounded-lg border">
                      <div className="border-border/70 bg-muted/30 border-b px-4 py-3">
                        <p className="text-foreground text-sm font-semibold">
                          Content changes
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {memoryVersionSubtitle(detail.version)}
                        </p>
                      </div>
                      <MemoryUnifiedDiff unifiedDiff={detail.unified_diff} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmVersion !== null}
        onOpenChange={(nextOpen) => !nextOpen && setConfirmVersion(null)}
      >
        <DialogContent className="w-[min(96vw,72rem)] max-w-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Revert to Version {confirmVersion}?</DialogTitle>
            <DialogDescription>
              This restores only content and description. The current path,
              name, folder, kind, and metadata stay unchanged, and the Revert is
              recorded as a new Version.
            </DialogDescription>
          </DialogHeader>

          {comparison ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-border/70 bg-muted/20 rounded-lg border p-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    Current content
                  </p>
                  <pre className="bg-background mt-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                    {comparison.currentContent || "(empty)"}
                  </pre>
                </div>
                <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    After Revert · Version {confirmVersion}
                  </p>
                  <pre className="bg-background mt-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                    {comparison.targetContent || "(empty)"}
                  </pre>
                </div>
              </div>
              <div className="border-border/70 bg-muted/20 rounded-lg border p-3">
                <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                  Description
                </p>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <span className="bg-background rounded px-2 py-1 break-words">
                    {comparison.currentDescription || "None"}
                  </span>
                  <span className="text-muted-foreground hidden sm:inline">
                    →
                  </span>
                  <span className="bg-background rounded px-2 py-1 break-words">
                    {comparison.targetDescription || "None"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={revertEntry.isPending}
              onClick={() => setConfirmVersion(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={revertEntry.isPending || !comparison?.hasChanges}
              onClick={() => void confirmRevert()}
            >
              {revertEntry.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Confirm Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
