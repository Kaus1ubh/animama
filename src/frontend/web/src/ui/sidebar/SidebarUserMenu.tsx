"use client";

import { Settings } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useUserProfile } from "@/query/hooks/useUserProfile";
import { Avatar, AvatarFallback } from "@/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { ApplicationSettingsModal } from "@/ui/sidebar/ApplicationSettingsModal";
import { useCloseMobileSidebar, useSidebar } from "@/ui/sidebar/Sidebar";
import {
  useOptionalAccountAffordances,
  useOptionalRuntimeController,
} from "@web/app/runtime/RuntimeAdmissionProvider";
import { AccountUsage } from "./AccountUsage";

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

/** Show admitted personalization and composition-provided account controls. */
export function SidebarUserMenu() {
  const { open } = useSidebar();
  const closeMobileSidebar = useCloseMobileSidebar();
  const profile = useUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [applicationSettingsOpen, setApplicationSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const controller = useOptionalRuntimeController();
  const account = controller?.composition.accountActions;
  const canOpenAccount =
    useOptionalAccountAffordances()?.canOpenAccount ?? false;
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
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              closeMobileSidebar();
              setApplicationSettingsOpen(true);
            }}
          >
            <Settings className="h-4 w-4" />
            App Settings
          </DropdownMenuItem>
          {account ? (
            <>
              {canOpenAccount ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    try {
                      account.openAccount();
                    } catch (error) {
                      setAccountError(
                        error instanceof Error
                          ? error.message
                          : "Account access is unavailable.",
                      );
                    }
                  }}
                >
                  Account
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  closeMobileSidebar();
                  setUsageOpen(true);
                }}
              >
                Usage and limits
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void controller!.signOut().catch(() => {});
                }}
              >
                Sign out
              </DropdownMenuItem>
              {accountError ? (
                <p role="alert" className="text-muted-foreground px-2 text-sm">
                  {accountError}
                </p>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ApplicationSettingsModal
        open={applicationSettingsOpen}
        onOpenChange={setApplicationSettingsOpen}
      />
      {account ? (
        <AccountUsage
          actions={account}
          open={usageOpen}
          onOpenChange={setUsageOpen}
        />
      ) : null}
    </>
  );
}
