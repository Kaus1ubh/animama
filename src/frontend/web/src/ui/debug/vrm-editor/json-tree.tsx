"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type JsonExpandMode = "smart" | "all" | "collapsed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getJsonNodeDefaultOpen(
  depth: number,
  expandMode: JsonExpandMode,
): boolean {
  if (depth === 0) return true;
  if (expandMode === "all") return true;
  if (expandMode === "collapsed") return false;
  return depth <= 1;
}

function JsonPrimitiveValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (typeof value === "string") {
    return <span className="text-emerald-600">{`"${value}"`}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-sky-600">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-violet-600">{String(value)}</span>;
  }
  if (value === undefined) {
    return <span className="text-muted-foreground">undefined</span>;
  }
  return <span>{String(value)}</span>;
}

export function JsonTreeNode({
  label,
  value,
  depth,
  expandMode,
}: {
  label: string | null;
  value: unknown;
  depth: number;
  expandMode: JsonExpandMode;
}) {
  const isArray = Array.isArray(value);
  const isObject = isRecord(value);
  const isContainer = isArray || isObject;
  const defaultOpen = getJsonNodeDefaultOpen(depth, expandMode);
  const [isOpen, setIsOpen] = useState(() => defaultOpen);

  if (!isContainer) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 font-mono text-xs",
          depth > 0 && "border-border/50 border-l pl-4",
        )}
      >
        {label ? (
          <span className="text-foreground/80 shrink-0">{`"${label}":`}</span>
        ) : null}
        <JsonPrimitiveValue value={value} />
      </div>
    );
  }

  const entries = isArray
    ? value.map((item, index) => [`[${index}]`, item] as const)
    : Object.entries(value);
  const containerLabel =
    label ?? (depth === 0 ? "root" : isArray ? "array" : "object");
  const summarySuffix = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className={cn(depth > 0 && "border-border/50 border-l pl-4")}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left font-mono text-xs transition"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        )}
        <span className="text-foreground/85 truncate">{`"${containerLabel}"`}</span>
        <span className="text-muted-foreground shrink-0">{summarySuffix}</span>
      </button>
      {isOpen ? (
        <div className="mt-1 space-y-1">
          {entries.length > 0 ? (
            entries.map(([entryLabel, entryValue]) => (
              <JsonTreeNode
                key={`${containerLabel}:${entryLabel}`}
                label={entryLabel}
                value={entryValue}
                depth={depth + 1}
                expandMode={expandMode}
              />
            ))
          ) : (
            <div className="text-muted-foreground pl-6 font-mono text-xs">
              {isArray ? "[]" : "{}"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
