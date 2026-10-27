"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonNodeProps = {
  /** The member name, or null for an array item or the root. */
  name: string | null;
  value: JsonValue;
  depth: number;
  /** Containers deeper than this start collapsed. */
  openDepth: number;
  last: boolean;
};

function isContainer(
  value: JsonValue,
): value is readonly JsonValue[] | { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null;
}

function Name({ name }: { name: string | null }) {
  if (name === null) return null;
  return (
    <>
      <span className="text-foreground">{JSON.stringify(name)}</span>
      <span className="text-muted-foreground">: </span>
    </>
  );
}

function Scalar({ value }: { value: JsonValue }) {
  return (
    <span
      className={cn(
        typeof value === "string" ? "text-success" : "text-info",
        value === null && "text-muted-foreground",
      )}
    >
      {JSON.stringify(value)}
    </span>
  );
}

function JsonNode({ name, value, depth, openDepth, last }: JsonNodeProps) {
  const [open, setOpen] = useState(depth < openDepth);
  const comma = last ? null : <span className="text-muted-foreground">,</span>;
  if (!isContainer(value)) {
    return (
      <div className="pl-5">
        <Name name={name} />
        <Scalar value={value} />
        {comma}
      </div>
    );
  }
  const isArray = Array.isArray(value);
  const entries: [string | null, JsonValue][] = isArray
    ? (value as readonly JsonValue[]).map((item) => [null, item])
    : Object.entries(value);
  const [opening, closing] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    return (
      <div className="pl-5">
        <Name name={name} />
        <span className="text-muted-foreground">
          {opening}
          {closing}
        </span>
        {comma}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="hover:bg-muted/60 focus-visible:ring-ring flex items-center rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "text-muted-foreground mr-1 h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Name name={name} />
        <span className="text-muted-foreground">
          {open ? opening : `${opening}…${closing}`}
        </span>
        {open ? null : (
          <span className="text-muted-foreground ml-2">{entries.length}</span>
        )}
        {open ? null : comma}
      </button>
      {open ? (
        <>
          <div className="border-border/60 ml-2 border-l pl-2">
            {entries.map(([childName, child], index) => (
              <JsonNode
                key={childName ?? index}
                name={childName}
                value={child}
                depth={depth + 1}
                openDepth={openDepth}
                last={index === entries.length - 1}
              />
            ))}
          </div>
          <div className="pl-5">
            <span className="text-muted-foreground">{closing}</span>
            {comma}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A read-only JSON document whose objects and arrays expand and collapse.
 * Each container is a button with `aria-expanded`, so the tree works with the
 * keyboard. Remount it (a new `key`) to apply a different `openDepth`.
 */
export function JsonTree({
  value,
  openDepth,
  label,
  className,
}: {
  value: unknown;
  openDepth: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("font-mono text-xs leading-relaxed", className)}
    >
      <JsonNode
        name={null}
        value={value as JsonValue}
        depth={0}
        openDepth={openDepth}
        last
      />
    </div>
  );
}
