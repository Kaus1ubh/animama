"use client";

import type { ReactNode } from "react";
import {
  ChevronDown,
  Hand,
  HeartHandshake,
  Layers3,
  ScanFace,
  Sparkles,
  UserRound,
  Volume2,
} from "lucide-react";

import type { LibraryRowPresentation } from "@/lib/content/libraryPresentation";
import { cn } from "@/lib/utils";

type RowFamily = LibraryRowPresentation["family"];

const icons = {
  gesture: Hand,
  reaction: HeartHandshake,
  particle: Sparkles,
  "avatar-effect": ScanFace,
  scene: Layers3,
  sound: Volume2,
  avatar: UserRound,
} satisfies Record<RowFamily, typeof Hand>;

/** Shared, responsive product row that leaves actions owned by each domain. */
export function LibraryProductRow({
  row,
  actions,
  className,
}: {
  row: LibraryRowPresentation;
  actions: ReactNode;
  className?: string;
}) {
  const Icon = icons[row.family];
  return (
    <article
      aria-label={row.name}
      className={cn(
        "bg-card flex min-w-0 flex-col border-b last:border-b-0 sm:flex-row sm:items-stretch",
        className,
      )}
    >
      <details className="group min-w-0 flex-1">
        <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
          <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.name}</span>
              {row.updateAvailable ? (
                <span className="border-primary/35 bg-primary/10 text-primary rounded-full border px-2 py-0.5 text-[11px] font-medium">
                  Update available
                </span>
              ) : null}
              {row.equippedCount ? (
                <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">
                  Added to {row.equippedCount}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground mt-0.5 block truncate text-sm">
              {row.description}
            </span>
            <span className="text-muted-foreground mt-1 block truncate text-xs">
              {row.metadata.join(" · ")}
            </span>
          </span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t px-4 py-3 text-sm sm:pl-[4.25rem]">
          <p className="text-foreground/85 leading-6">{row.description}</p>
          <dl className="text-muted-foreground mt-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="sr-only">Origin</dt>
              <dd>Origin: {row.origin}</dd>
            </div>
            {row.includedCount ? (
              <div>
                <dt className="sr-only">Included resources</dt>
                <dd>
                  Includes {row.includedCount} resource
                  {row.includedCount === 1 ? "" : "s"}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </details>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 sm:max-w-[48%] sm:justify-end sm:border-t-0 sm:border-l">
        {actions}
      </div>
    </article>
  );
}
