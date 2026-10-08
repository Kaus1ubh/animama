"use client";

import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PyMemoryPatchPreview } from "@/lib/content/catalogTypes";
import { memoryDescriptionChange } from "@/lib/memory-manager/description-change";
import { previewWithDisplayPath } from "@/lib/memory-manager/display-path";
import { parseUnifiedDiff } from "@/lib/memory-manager/unified-diff";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

const COLLAPSED_LINE_COUNT = 80;

function operationLabel(operation: PyMemoryPatchPreview["operation"]) {
  if (operation === "create") return "Create";
  if (operation === "update") return "Update";
  return "Delete";
}

type ParsedDiffLine = ReturnType<typeof parseUnifiedDiff>[number];

function diffLineClassName(kind: ParsedDiffLine["kind"]) {
  if (kind === "add") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100";
  }
  if (kind === "remove") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100";
  }
  if (kind === "hunk") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100";
  }
  if (kind === "file") {
    return "border-border bg-muted/50 text-muted-foreground";
  }
  return "border-transparent text-muted-foreground";
}

export function MemoryDiffViewer({
  preview: sourcePreview,
  pathLabel,
  className,
}: {
  preview: PyMemoryPatchPreview;
  /** Owner-facing target path, such as `Animas/<name>/IDENTITY.md`. */
  pathLabel?: string;
  className?: string;
}) {
  const preview = previewWithDisplayPath(sourcePreview, pathLabel);
  const descriptionChange = memoryDescriptionChange(preview);

  return (
    <div
      className={cn(
        "border-border/70 bg-background overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="border-border/70 bg-muted/30 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-background border-border flex size-9 shrink-0 items-center justify-center rounded-md border">
            <FileDiff className="text-muted-foreground size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground text-sm font-semibold">
                {operationLabel(preview.operation)}
              </span>
              <span className="text-muted-foreground truncate font-mono text-xs">
                {preview.path}
              </span>
            </div>
            {preview.summary ? (
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {preview.summary}
              </p>
            ) : null}
          </div>
        </div>
        {preview.expected_version !== null &&
        preview.expected_version !== undefined ? (
          <span className="text-muted-foreground text-xs">
            Version {preview.expected_version}
          </span>
        ) : null}
      </div>

      {descriptionChange ? (
        <section className="border-border/70 border-b px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-foreground text-xs font-semibold tracking-wide uppercase">
              Description
            </h4>
            <span className="text-muted-foreground text-xs capitalize">
              {descriptionChange.kind}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <DescriptionValue
              label="Before"
              value={descriptionChange.oldValue}
            />
            <DescriptionValue
              label="After"
              value={descriptionChange.newValue}
            />
          </div>
        </section>
      ) : null}

      <MemoryUnifiedDiff
        unifiedDiff={preview.unified_diff}
        emptyMessage="No content changes."
      />
    </div>
  );
}

function DescriptionValue({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="border-border/70 bg-muted/20 min-w-0 rounded-md border px-3 py-2">
      <div className="text-muted-foreground text-2xs mb-1 font-medium tracking-wide uppercase">
        {label}
      </div>
      <p
        className={cn(
          "text-sm break-words whitespace-pre-wrap",
          value === null ? "text-muted-foreground italic" : "text-foreground",
        )}
      >
        {value ?? "No description"}
      </p>
    </div>
  );
}

/** Renders reusable unified-diff lines without assuming an approval payload. */
export function MemoryUnifiedDiff({
  unifiedDiff,
  emptyMessage = "No textual changes in this version.",
}: {
  unifiedDiff: string | null | undefined;
  emptyMessage?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => parseUnifiedDiff(unifiedDiff), [unifiedDiff]);
  const collapsible = lines.length > COLLAPSED_LINE_COUNT;
  const visibleLines =
    collapsible && !expanded ? lines.slice(0, COLLAPSED_LINE_COUNT) : lines;

  useEffect(() => setExpanded(false), [unifiedDiff]);

  return (
    <>
      {lines.length === 0 ? (
        <div className="text-muted-foreground px-4 py-6 text-sm">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-full py-2 font-mono text-xs leading-5">
            {visibleLines.map((line) => (
              <div
                key={line.id}
                className={cn(
                  "border-l-2 px-4 whitespace-pre",
                  diffLineClassName(line.kind),
                )}
              >
                {line.content || " "}
              </div>
            ))}
          </div>
        </div>
      )}

      {collapsible ? (
        <div className="border-border/70 bg-muted/20 border-t px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {expanded ? "Show less" : `Show ${lines.length} lines`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
