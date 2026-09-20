"use client";

import { Settings, User } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { featureFlags } from "@/lib/feature-flags";
import { useUserProfile } from "@/query/hooks/useUserProfile";
import { Avatar, AvatarFallback } from "@/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import { Theme } from "@/ui/components/theme";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { LocalPersonalizationModal } from "@/ui/profile/LocalPersonalizationModal";
import { ApplicationSettingsModal } from "@/ui/sidebar/ApplicationSettingsModal";
import { useSidebar } from "@/ui/sidebar/Sidebar";
import { ensureCustomTheme } from "@/ui/theme/custom-theme";
import { CustomThemeModal } from "@/ui/theme/custom-theme-modal";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** Show private installation personalization and application controls. */
export function SidebarUserMenu() {
  const { open } = useSidebar();
  const profile = useUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [applicationSettingsOpen, setApplicationSettingsOpen] = useState(false);
  const displayName = profile.data?.display_name?.trim() || "You";
  const triggerButton = (
    <button
      type="button"
      className={cn(
        "group/sidebar text-sidebar-foreground dark:text-sidebar-foreground flex items-center text-left",
        open
          ? "hover:bg-sidebar-accent/60 h-[44px] w-full gap-2 rounded-md px-2"
          : "border-border/60 bg-background/60 text-foreground/80 hover:bg-muted/70 hover:text-foreground h-11 w-11 justify-center rounded-full border p-0 shadow-sm backdrop-blur-md",
      )}
      aria-label={open ? undefined : displayName}
    >
      <Avatar
        className={cn(
          "ring-border shrink-0 ring-1",
          open ? "size-8" : "size-10",
        )}
      >
        <AvatarFallback className="text-xs font-medium">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      {open ? (
        <span className="!m-0 inline-block !p-0 text-sm whitespace-pre transition duration-150 group-hover/sidebar:translate-x-1">
          {displayName}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {open ? (
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {displayName}
            </TooltipContent>
          </Tooltip>
        )}
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={12}
          className="z-[130] w-72 p-3"
        >
          {featureFlags.themeSelection ? (
            <>
              <DropdownMenuLabel className="text-muted-foreground dark:text-muted-foreground text-xs font-medium">
                Theme
              </DropdownMenuLabel>
              <div className="px-1 pb-2">
                <Theme
                  variant="tabs"
                  size="sm"
                  showLabel
                  themes={["light", "dark", "custom"]}
                  onCustomSelect={() => {
                    ensureCustomTheme();
                    setCustomOpen(true);
                    setMenuOpen(false);
                  }}
                  className="w-full"
                />
              </div>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setPersonalizationOpen(true);
            }}
          >
            <User className="h-4 w-4" />
            Personalization
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setApplicationSettingsOpen(true);
            }}
          >
            <Settings className="h-4 w-4" />
            Application settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {featureFlags.themeSelection ? (
        <CustomThemeModal open={customOpen} onOpenChange={setCustomOpen} />
      ) : null}
      <LocalPersonalizationModal
        open={personalizationOpen}
        onOpenChange={setPersonalizationOpen}
      />
      <ApplicationSettingsModal
        open={applicationSettingsOpen}
        onOpenChange={setApplicationSettingsOpen}
      />
    </>
  );
}
