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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatters } from "@animama/product-ui/i18n";

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

/** A version's creation time, or null when it is missing or unreadable. */
function versionDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function VersionFieldChange({
  label,
  change,
}: {
  label: string;
  change: PyMemoryEntryVersionFieldChange;
}) {
  const { t } = useTranslation("memory");
  return (
    <div className="border-border/70 bg-muted/20 rounded-md border p-3">
      <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </p>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <code className="bg-background min-w-0 rounded px-2 py-1 break-words">
          {change.old || t("shared.none")}
        </code>
        <span className="text-muted-foreground hidden sm:inline">→</span>
        <code className="bg-background min-w-0 rounded px-2 py-1 break-words">
          {change.new || t("shared.none")}
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
  const { t } = useTranslation("memory");
  const formatters = useFormatters();
  const formatVersionTime = (value: string | null | undefined) => {
    const date = versionDate(value);
    return date ? formatters.dateTime(date) : t("versions.timeUnavailable");
  };
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
      toast.success(t("versions.reverted", { version: confirmVersion }), {
        description: t("versions.revertedDescription", {
          version: updated.version,
        }),
      });
    } catch (error) {
      if (isMemoryEntryConflict(error)) {
        setConfirmVersion(null);
        toast.error(t("versions.revertConflict"), {
          description: t("versions.revertConflictDescription"),
        });
        return;
      }
      toast.error(t("versions.revertFailed"), {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          avoidSidebar
          className="flex h-[min(88vh,52rem)] w-[min(96vw,72rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogHeader className="border-border/70 shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2">
              <FileClock className="size-5" /> {t("versions.title")}
            </DialogTitle>
            <DialogDescription className="truncate">
              {t("versions.currentVersion", {
                path: entry?.path ?? t("versions.entryFallback"),
                version: entry?.version ?? "—",
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 sm:grid-cols-[18rem_minmax(0,1fr)]">
            <section
              aria-label={t("versions.listLabel")}
              className={`border-border/70 min-h-0 flex-col overflow-hidden border-r ${
                mobileView === "list" ? "flex" : "hidden sm:flex"
              }`}
            >
              <div className="text-muted-foreground border-border/70 border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
                {t("versions.history")}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {versionsQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center justify-center p-6 text-sm">
                    <Loader2 className="mr-2 size-4 animate-spin" />{" "}
                    {t("versions.loading")}
                  </div>
                ) : versionsQuery.isError ? (
                  <div className="text-destructive space-y-3 p-4 text-sm">
                    <p>{t("versions.loadFailed")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void versionsQuery.refetch()}
                    >
                      <RefreshCw className="size-4" /> {t("shared.retry")}
                    </Button>
                  </div>
                ) : versions.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-sm">
                    {t("versions.none")}
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
                                {t("shared.version", {
                                  version: version.version,
                                })}
                              </span>
                              {version.version === entry?.version ? (
                                <span className="bg-primary/10 text-primary text-2xs rounded px-1.5 py-0.5 font-semibold uppercase">
                                  {t("versions.current")}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {t("versions.operationLine", {
                                operation: memoryVersionOperationLabel(
                                  version.operation,
                                ),
                                time: formatVersionTime(version.created_at),
                              })}
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
                    {t("versions.loadOlder")}
                  </Button>
                </div>
              ) : null}
            </section>

            <section
              aria-label={t("versions.detailLabel")}
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
                  <ArrowLeft className="size-4" /> {t("versions.back")}
                </Button>
                <div className="min-w-0">
                  <h3 className="text-foreground truncate text-sm font-semibold">
                    {selectedVersion
                      ? memoryVersionTitle(selectedVersion)
                      : t("versions.selectVersion")}
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
                    {t("versions.revertTo", { version: selectedVersion ?? "" })}
                  </Button>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                {!selectedVersion ? (
                  <p className="text-muted-foreground text-sm">
                    {t("versions.selectHint")}
                  </p>
                ) : detailQuery.isLoading ? (
                  <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
                    <Loader2 className="mr-2 size-4 animate-spin" />{" "}
                    {t("versions.loadingChanges")}
                  </div>
                ) : detailQuery.isError || !detail ? (
                  <div className="text-destructive space-y-3 p-4 text-sm">
                    <p>{t("versions.versionLoadFailed")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void detailQuery.refetch()}
                    >
                      <RefreshCw className="size-4" /> {t("shared.retry")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {discardPromptOpen ? (
                      <div className="border-warning/30 bg-warning/5 rounded-lg border p-4">
                        <p className="text-foreground text-sm font-semibold">
                          {t("versions.discardFirst")}
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {t("versions.discardFirstDescription")}
                        </p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDiscardPromptOpen(false)}
                          >
                            {t("versions.keepDraft")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={discardAndContinue}
                          >
                            {t("versions.discardAndContinue")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {detail.path_change || detail.description_change ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {detail.path_change ? (
                          <VersionFieldChange
                            label={t("versions.path")}
                            change={detail.path_change}
                          />
                        ) : null}
                        {detail.description_change ? (
                          <VersionFieldChange
                            label={t("shared.description")}
                            change={detail.description_change}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="border-border/70 bg-background overflow-hidden rounded-lg border">
                      <div className="border-border/70 bg-muted/30 border-b px-4 py-3">
                        <p className="text-foreground text-sm font-semibold">
                          {t("versions.contentChanges")}
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
            <DialogTitle>
              {t("versions.revertConfirmTitle", {
                version: confirmVersion ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("versions.revertConfirmDescription")}
            </DialogDescription>
          </DialogHeader>

          {comparison ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-border/70 bg-muted/20 rounded-lg border p-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    {t("versions.currentContent")}
                  </p>
                  <pre className="bg-background mt-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                    {comparison.currentContent || t("versions.emptyContent")}
                  </pre>
                </div>
                <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
                  <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    {t("versions.afterRevert", {
                      version: confirmVersion ?? "",
                    })}
                  </p>
                  <pre className="bg-background mt-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                    {comparison.targetContent || t("versions.emptyContent")}
                  </pre>
                </div>
              </div>
              <div className="border-border/70 bg-muted/20 rounded-lg border p-3">
                <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
                  {t("shared.description")}
                </p>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <span className="bg-background rounded px-2 py-1 break-words">
                    {comparison.currentDescription || t("shared.none")}
                  </span>
                  <span className="text-muted-foreground hidden sm:inline">
                    →
                  </span>
                  <span className="bg-background rounded px-2 py-1 break-words">
                    {comparison.targetDescription || t("shared.none")}
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
              {t("shared.cancel")}
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
              {t("versions.confirmRevert")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
