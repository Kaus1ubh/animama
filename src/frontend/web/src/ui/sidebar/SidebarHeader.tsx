"use client";

import { Logo, LogoMark } from "@/ui/components/logo";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/ui/sidebar/Sidebar";
import { PanelLeft, Search } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

type SidebarHeaderProps = {
  showOpenHeader: boolean;
  onSearch: () => void;
};

export const SidebarHeader = ({
  showOpenHeader,
  onSearch,
}: SidebarHeaderProps) => {
  const { setOpen } = useSidebar();

  if (showOpenHeader) {
    return (
      <div className="flex h-11 w-full items-center justify-between">
        <Logo />
        <div className="flex items-center">
          <button
            type="button"
            onClick={onSearch}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md",
              "text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors",
            )}
            aria-label="Search chats"
            title="Search chats"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-md",
              "text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors",
            )}
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "border-border/60 bg-background/60 text-foreground/80 hover:bg-muted/70 hover:text-foreground flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition-colors",
      )}
      aria-label="Open sidebar"
    >
      <span className="items-center group-hover/sidebar-shell:hidden">
        <LogoMark />
      </span>
      <span className="hidden items-center group-hover/sidebar-shell:flex">
        <PanelLeft className="h-5 w-5" />
      </span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        Open sidebar
      </TooltipContent>
    </Tooltip>
  );
};
