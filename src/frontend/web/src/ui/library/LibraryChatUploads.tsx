"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, RefreshCw, Search } from "lucide-react";

import type { ContentLibrarySearch } from "@/lib/content/librarySearch";
import {
  filterLibraryUploads,
  LIBRARY_UPLOAD_PAGE_SIZE,
  libraryUploadViewState,
  presentLibraryUpload,
  type LibraryUploadListRow,
  type LibraryUploadStatusTone,
} from "@/lib/uploads/libraryUploads";
import { cn } from "@/lib/utils";
import { useUserFiles } from "@/query/hooks/useUserFiles";
import { Button } from "@/ui/components/button";
import { Card, CardContent } from "@/ui/components/card";
import { Input } from "@/ui/components/input";
import { LibraryChatUploadsDebugPanel } from "@/ui/library/LibraryChatUploadsDebugPanel";
import { LibraryFilterMenu } from "@/ui/library/LibraryFilterMenu";

const UPLOAD_SEARCH_DEBOUNCE_MS = 300;

const STATUS_STYLES: Record<LibraryUploadStatusTone, string> = {
  active:
    "border-warning/30 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted/40 text-muted-foreground",
  success:
    "border-success/30 bg-success/10 text-success",
  warning: "border-info/30 bg-info/10 text-info",
};

function UploadStatus({
  active,
  label,
  tone,
}: {
  active: boolean;
  label: string;
  tone: LibraryUploadStatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium",
        STATUS_STYLES[tone],
      )}
    >
      {active ? (
        <Loader2
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      {label}
    </span>
  );
}

function UploadRow({ row }: { row: LibraryUploadListRow }) {
  return (
    <div className="border-border/70 flex min-w-0 flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-nowrap">
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <FileText className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.name}</p>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span>{row.extension}</span>
          <span aria-hidden="true">·</span>
          <span>{row.size}</span>
          {row.contentType ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="max-w-52 truncate">{row.contentType}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>{row.createdAt}</span>
        </div>
        {row.error ? (
          <p className="text-destructive mt-1 text-xs break-words">
            {row.error}
          </p>
        ) : null}
      </div>
      <div className="ml-12 flex w-full items-center justify-end gap-2 sm:ml-0 sm:w-auto">
        <UploadStatus
          active={row.active}
          label={row.statusLabel}
          tone={row.statusTone}
        />
        <Button asChild size="sm" variant="ghost" className="min-h-10 shrink-0">
          <a href="#chat-upload-debug-tools" aria-label={`Manage ${row.name}`}>
            Manage
          </a>
        </Button>
      </div>
    </div>
  );
}

function UploadEmptyState({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="border-border/70 m-4 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">
        {filtered ? "No matching Chat Uploads" : "No Chat Uploads yet"}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {filtered
          ? "Try another filename or upload status."
          : "Add a file through chat or the Memories Uploads manager."}
      </p>
      {filtered ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4 min-h-10"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      ) : (
        <Button asChild size="sm" variant="outline" className="mt-4 min-h-10">
          <a href="#chat-upload-debug-tools">Open Uploads manager</a>
        </Button>
      )}
    </div>
  );
}

/** Focused native Chat Upload inventory with active-work polling. */
export function LibraryChatUploads({
  search,
  onSearchChange,
}: {
  search: ContentLibrarySearch;
  onSearchChange: (update: Partial<ContentLibrarySearch>) => void;
}) {
  const files = useUserFiles({ pollActive: true });
  const [queryDraft, setQueryDraft] = useState(search.uploadQuery ?? "");
  const [visibleCount, setVisibleCount] = useState(LIBRARY_UPLOAD_PAGE_SIZE);
  const filtered = useMemo(
    () =>
      filterLibraryUploads(files.data ?? [], {
        query: search.uploadQuery,
        status: search.uploadStatus,
      }),
    [files.data, search.uploadQuery, search.uploadStatus],
  );
  const rows = useMemo(
    () => filtered.slice(0, visibleCount).map(presentLibraryUpload),
    [filtered, visibleCount],
  );
  const state = libraryUploadViewState({
    isPending: files.isPending,
    isError: files.isError,
    totalCount: files.data?.length ?? 0,
    filteredCount: filtered.length,
  });

  useEffect(() => {
    setQueryDraft(search.uploadQuery ?? "");
  }, [search.uploadQuery]);

  useEffect(() => {
    const normalized = queryDraft.trim();
    if (normalized === (search.uploadQuery ?? "")) return;
    const timeout = window.setTimeout(() => {
      onSearchChange({ uploadQuery: normalized || undefined });
    }, UPLOAD_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [onSearchChange, queryDraft, search.uploadQuery]);

  useEffect(() => {
    setVisibleCount(LIBRARY_UPLOAD_PAGE_SIZE);
  }, [search.uploadQuery, search.uploadStatus]);

  return (
    <section aria-labelledby="library-uploads-heading">
      <Card className="border-border/70 overflow-hidden shadow-sm">
        <CardContent className="p-0">
          <div className="border-border/70 flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-baseline gap-3">
                <h2
                  id="library-uploads-heading"
                  className="text-base font-semibold"
                >
                  Chat Uploads
                </h2>
                {!files.isPending && !files.isError ? (
                  <span className="text-muted-foreground text-xs">
                    {filtered.length === (files.data?.length ?? 0)
                      ? `${filtered.length} ${filtered.length === 1 ? "upload" : "uploads"}`
                      : `${filtered.length} of ${files.data?.length ?? 0}`}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <label className="relative block min-w-0 flex-1">
                  <span className="sr-only">Search Chat Uploads</span>
                  <Search
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <Input
                    value={queryDraft}
                    maxLength={80}
                    className="h-11 pl-9"
                    placeholder="Search Chat Uploads"
                    onChange={(event) => setQueryDraft(event.target.value)}
                  />
                </label>
                <LibraryFilterMenu
                  search={search}
                  onSearchChange={onSearchChange}
                />
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="h-11">
              <a href="#chat-upload-debug-tools">Manage uploads</a>
            </Button>
          </div>

          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {state === "loading"
              ? "Loading Chat Uploads."
              : state === "error"
                ? "Chat Uploads could not be loaded."
                : state === "empty"
                  ? "No Chat Uploads yet."
                  : state === "no_results"
                    ? "No Chat Uploads match the current filters."
                    : `Showing ${rows.length} of ${filtered.length} matching Chat Uploads.`}
          </p>

          {state === "loading" ? (
            <p className="text-muted-foreground p-6 text-sm" role="status">
              Loading Chat Uploads…
            </p>
          ) : state === "error" ? (
            <div
              className="flex flex-wrap items-center justify-between gap-4 p-6"
              role="alert"
            >
              <p className="text-destructive text-sm">
                Your Chat Uploads could not be loaded.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-10"
                onClick={() => void files.refetch()}
              >
                <RefreshCw className="size-4" /> Retry
              </Button>
            </div>
          ) : state === "empty" || state === "no_results" ? (
            <UploadEmptyState
              filtered={state === "no_results"}
              onClearFilters={() =>
                onSearchChange({
                  uploadQuery: undefined,
                  uploadStatus: "all",
                })
              }
            />
          ) : (
            <>
              <div>
                {rows.map((row) => (
                  <UploadRow key={row.key} row={row} />
                ))}
              </div>
              {visibleCount < filtered.length ? (
                <div className="border-border/70 flex justify-center border-t p-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-10"
                    onClick={() =>
                      setVisibleCount((current) =>
                        Math.min(
                          current + LIBRARY_UPLOAD_PAGE_SIZE,
                          filtered.length,
                        ),
                      )
                    }
                  >
                    Show more Chat Uploads
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      <LibraryChatUploadsDebugPanel />
    </section>
  );
}
