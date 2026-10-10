"use client";

import { AlertTriangle, LoaderCircle, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import {
  useContentCatalog,
  useRescanContent,
} from "@/query/hooks/useContentCatalog";
import { Button } from "@/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

/** Stay quiet during normal scans; expose recoverable catalog problems on demand. */
export function ContentHealth({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const catalog = useContentCatalog();
  const rescan = useRescanContent();
  const { data: capabilities } = useRuntimeCapabilities();
  const canScan = capabilities?.local_filesystem_administration === true;
  // Invalid items, and valid Actions that play without a removed Included
  // effect until their events are repaired.
  const affected = (catalog.data?.items ?? []).filter(
    (item) =>
      item.status !== "valid" ||
      item.diagnostics.some(
        (diagnostic) => diagnostic.code === "missing_effect_dependency",
      ),
  );
  const needsAttention =
    catalog.isError || affected.length > 0 || catalog.data?.scan_required;

  // Background polling is not an error or a reason to show a permanent control.
  if (!needsAttention) return null;

  const label = catalog.isError
    ? "Content library unavailable"
    : "Content needs attention";
  const Icon = catalog.isError ? WifiOff : AlertTriangle;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          title={label}
          className={cn("text-warning", compact && "size-6", className)}
        >
          <Icon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 space-y-3 text-sm"
      >
        <p className="font-medium">{label}</p>
        {catalog.isError ? (
          <p>Could not load the content library. Retry to check again.</p>
        ) : null}
        {affected.length ? (
          <ul className="max-h-64 space-y-3 overflow-y-auto">
            {affected.map((item) => (
              <li key={item.item_id} className="space-y-1">
                <p className="font-medium">{item.display_name}</p>
                {item.diagnostics.length ? (
                  item.diagnostics.map((diagnostic, index) => (
                    <div
                      key={`${diagnostic.code}:${index}`}
                      className="text-muted-foreground text-xs"
                    >
                      <p>{diagnostic.message}</p>
                      <p className="font-mono break-all">
                        {diagnostic.code}
                        {diagnostic.relative_path
                          ? ` · ${diagnostic.relative_path}`
                          : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {item.status === "missing"
                      ? "The file or folder is missing."
                      : item.status === "scan_required"
                        ? "Changes are waiting to be scanned."
                        : "This item did not pass validation."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : catalog.data?.scan_required ? (
          <p>
            {canScan
              ? "Local changes need another scan."
              : "The operator is reconciling content changes."}
          </p>
        ) : null}
        {rescan.isError ? (
          <p role="alert" className="text-destructive">
            The scan failed. Try again.
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={canScan ? rescan.isPending : catalog.isFetching}
          onClick={() => {
            if (canScan) rescan.mutate();
            else void catalog.refetch();
          }}
        >
          {canScan && rescan.isPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : null}
          {canScan
            ? rescan.isPending
              ? "Scanning…"
              : "Retry scan"
            : "Retry Library"}
        </Button>
        {!canScan ? (
          <p className="text-muted-foreground text-xs">
            Host file scanning is managed by the operator.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
