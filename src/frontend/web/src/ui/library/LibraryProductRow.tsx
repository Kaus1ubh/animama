"use client";

import type { ReactNode } from "react";
import {
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
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/avatar";

type RowFamily = LibraryRowPresentation["family"];

const icons = {
  gesture: Hand,
  pose: UserRound,
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
  portraitUrl,
}: {
  row: LibraryRowPresentation;
  actions: ReactNode;
  className?: string;
  portraitUrl?: string | null;
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
      <div className="flex min-h-20 min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <Avatar className="size-10 rounded-lg">
          {portraitUrl ? (
            <AvatarImage src={portraitUrl} alt="" className="object-cover" />
          ) : null}
          <AvatarFallback className="text-muted-foreground rounded-lg">
            <Icon className="size-5" aria-hidden="true" />
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium">{row.name}</span>
            {row.family === "pose" && row.origin === "Mine" ? (
              <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">
                Local
              </span>
            ) : null}
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
          {row.description ? (
            <span className="text-muted-foreground mt-0.5 block text-sm">
              {row.description}
            </span>
          ) : null}
          {row.metadata.length ? (
            <span className="text-muted-foreground mt-1 block text-xs">
              {row.metadata.join(" · ")}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 sm:max-w-[48%] sm:justify-end sm:border-t-0 sm:border-l">
        {actions}
      </div>
    </article>
  );
}
