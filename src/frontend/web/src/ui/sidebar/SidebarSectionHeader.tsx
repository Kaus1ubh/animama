"use client";

import type { ReactNode } from "react";
import { ChevronDown, ListFilter } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";

type SidebarSectionHeaderProps = {
  label: string;
  expanded: boolean;
  controlsId: string;
  filterActive: boolean;
  filterLabel: string;
  onToggle: () => void;
  children: ReactNode;
};

/** Shared collapsible sidebar heading with a persistent filter-menu action. */
export function SidebarSectionHeader({
  label,
  expanded,
  controlsId,
  filterActive,
  filterLabel,
  onToggle,
  children,
}: SidebarSectionHeaderProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={onToggle}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 self-stretch rounded-md py-2 text-left text-xs font-medium",
          "text-muted-foreground hover:text-foreground focus-visible:ring-sidebar-ring transition-colors outline-none focus-visible:ring-2",
        )}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 opacity-0 transition-[transform,opacity]",
            "group-focus-within/sidebar-section:opacity-100 group-hover/sidebar-section:opacity-100",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={filterLabel}
            className={cn(
              "text-muted-foreground hover:text-foreground size-6 p-0 opacity-0 transition-[color,background-color,opacity] hover:bg-transparent",
              "pointer-events-none group-focus-within/sidebar-section:pointer-events-auto group-focus-within/sidebar-section:opacity-100 group-hover/sidebar-section:pointer-events-auto group-hover/sidebar-section:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
              filterActive && "text-sidebar-primary",
            )}
          >
            <ListFilter className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          className="z-[130] min-w-52"
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
