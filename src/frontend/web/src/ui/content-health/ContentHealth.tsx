"use client";

import { AlertTriangle, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useContentCatalog,
  useRescanContent,
} from "@/query/hooks/useContentCatalog";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

/** Discreet catalog health and manual Rescan control shared by creators/Library. */
export function ContentHealth({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const catalog = useContentCatalog();
  const rescan = useRescanContent();
  const items = catalog.data?.items ?? [];
  const invalid = items.filter(
    (item) => item.status === "invalid" || item.status === "missing",
  );
  const scanRequired = items.filter((item) => item.status === "scan_required");
  const busy = catalog.isPending || catalog.isFetching || rescan.isPending;

  let label = "";
  let Icon = RefreshCw;
  let tone = "text-muted-foreground";
  if (catalog.isError) {
    label = "Content library unavailable";
    Icon = WifiOff;
    tone = "text-destructive";
  } else if (busy) {
    label = "Scanning content library";
    Icon = LoaderCircle;
  } else if (invalid.length) {
    label = `${invalid.length} content ${invalid.length === 1 ? "issue" : "issues"}`;
    Icon = AlertTriangle;
    tone = "text-amber-600 dark:text-amber-400";
  } else if (scanRequired.length || catalog.data?.scan_required) {
    label = "Local changes need a Rescan";
    Icon = RefreshCw;
    tone = "text-amber-600 dark:text-amber-400";
  }

  const issueDetails = invalid.flatMap((item) => {
    if (item.diagnostics.length) {
      return item.diagnostics.map((diagnostic, index) => ({
        key: `${item.item_id}:${diagnostic.code}:${index}`,
        name: item.display_name,
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.relative_path ?? item.relative_locator,
      }));
    }
    return [
      {
        key: `${item.item_id}:${item.status}`,
        name: item.display_name,
        code: item.status,
        message:
          item.status === "missing"
            ? "The registered file or folder is no longer present."
            : "This item did not pass content validation.",
        path: item.relative_locator,
      },
    ];
  });
  const visibleIssueDetails = issueDetails.slice(0, 8);
  const hiddenIssueCount = issueDetails.length - visibleIssueDetails.length;
  const tooltipSummary = catalog.isError
    ? "Animama could not read the content catalog. Check the backend connection, then retry."
    : busy
      ? "Animama is validating the files under content/."
      : invalid.length
        ? "These items are unavailable until their files are corrected or removed and the library is rescanned."
        : scanRequired.length || catalog.data?.scan_required
          ? "Animama detected manual changes under content/. Select Rescan to validate and register them."
          : "";

  return (
    <div
      className={cn(
        "bg-background/85 flex items-center rounded-md border shadow-xs backdrop-blur-sm",
        compact ? "h-6 gap-0 px-1" : "h-8 gap-1 px-2",
        tone,
        className,
      )}
      role="status"
    >
      {label ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-full min-w-0 cursor-help items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-current",
                compact ? "px-0" : "pr-1",
              )}
              aria-label={`${label}. View content health details.`}
            >
              <Icon
                className={cn("size-3.5 shrink-0", busy && "animate-spin")}
              />
              <span
                className={compact ? "sr-only" : "max-w-52 truncate text-xs"}
              >
                {label}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent
            align="end"
            side="bottom"
            sideOffset={8}
            className="max-w-sm space-y-2 p-3 text-left text-pretty"
          >
            <p className="font-medium">{label}</p>
            <p className="opacity-85">{tooltipSummary}</p>
            {visibleIssueDetails.length ? (
              <ul className="space-y-2 border-t border-current/20 pt-2">
                {visibleIssueDetails.map((detail) => (
                  <li key={detail.key}>
                    <p className="font-medium">
                      {detail.name}{" "}
                      <span className="font-mono opacity-70">
                        [{detail.code}]
                      </span>
                    </p>
                    <p className="opacity-85">{detail.message}</p>
                    {detail.path ? (
                      <p className="mt-0.5 font-mono text-[0.6875rem] break-all opacity-70">
                        content/{detail.path}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {hiddenIssueCount > 0 ? (
              <p className="border-t border-current/20 pt-2 opacity-75">
                {hiddenIssueCount} more{" "}
                {hiddenIssueCount === 1 ? "issue" : "issues"} not shown.
              </p>
            ) : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={compact ? "-mr-1 size-5" : "-mr-2 size-7"}
        aria-label="Rescan content library"
        title="Rescan content/ for manual file changes"
        disabled={rescan.isPending}
        onClick={() => rescan.mutate()}
      >
        <RefreshCw
          className={cn("size-3.5", rescan.isPending && "animate-spin")}
        />
      </Button>
    </div>
  );
}
