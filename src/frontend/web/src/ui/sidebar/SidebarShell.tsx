"use client";

import React, { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  resolveAnimasNavigationTarget,
  resolveNewChatAnimaId,
} from "@/lib/animas/anima-management-search";
import { useAnimas } from "@/query/hooks/useAnimas";
import { Sidebar, SidebarBody, SidebarLink } from "@/ui/sidebar/Sidebar";
import {
  Brain,
  LibraryBig,
  MessagesSquare,
  Search,
  UsersRound,
} from "lucide-react";
import { SidebarHeader } from "@/ui/sidebar/SidebarHeader";
import { SidebarAnimas } from "@/ui/sidebar/SidebarAnimas";
import { SidebarChats } from "@/ui/sidebar/SidebarChats";
import { SidebarCreateMenu } from "@/ui/sidebar/SidebarCreateMenu";
import { SidebarUserMenu } from "@/ui/sidebar/SidebarUserMenu";
import { ChatSearchModal } from "@/ui/sidebar/ChatSearchModal";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { useSettings } from "@/ui/settings/SettingsProvider";

type SidebarShellProps = {
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
};

export function SidebarShell({
  open: openProp,
  setOpen: setOpenProp,
}: SidebarShellProps) {
  const { t } = useTranslation("sidebar");
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const animasQuery = useAnimas();
  const { userSettings, isLoading: settingsLoading } = useSettings();
  const newChatAnimaId = resolveNewChatAnimaId(
    animaId,
    settingsLoading ? null : userSettings?.last_active_anima_id,
    !settingsLoading && animasQuery.isSuccess
      ? animasQuery.data.map((anima) => anima.id)
      : [],
  );
  const appShell = useOptionalAppShell();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? appShell?.sidebarOpen ?? openState;
  const setOpen = setOpenProp ?? appShell?.setSidebarOpen ?? setOpenState;
  const animate = appShell
    ? appShell.sidebarAnimating && !appShell.suppressAnimations
    : true;
  const [searchOpen, setSearchOpen] = useState(false);
  // The mobile drawer is drawn above dialogs, so close it before searching.
  const openSearch = () => {
    if (appShell && !appShell.isDesktop) setOpen(false);
    setSearchOpen(true);
  };
  const sidebarLinks = useMemo(() => {
    const animasTarget = resolveAnimasNavigationTarget(animaId);
    return [
      {
        label: t("links.newChat"),
        ...(newChatAnimaId
          ? {
              to: "/$animaId" as const,
              params: { animaId: newChatAnimaId },
            }
          : { href: "#" as const }),
        icon: (
          <MessagesSquare className="text-sidebar-foreground dark:text-sidebar-foreground short:size-5 h-6 w-6 flex-shrink-0" />
        ),
      },
      {
        label: t("links.animas"),
        ...(animasTarget.route === "details"
          ? {
              to: "/animas/$animaId" as const,
              params: { animaId: animasTarget.animaId },
            }
          : { to: "/animas" as const }),
        icon: (
          <UsersRound className="text-sidebar-foreground dark:text-sidebar-foreground short:size-5 h-6 w-6 flex-shrink-0" />
        ),
      },
      {
        label: t("links.memory"),
        to: "/memories" as const,
        icon: (
          <Brain className="text-sidebar-foreground dark:text-sidebar-foreground short:size-5 h-6 w-6 flex-shrink-0" />
        ),
      },
      {
        label: t("links.library"),
        to: "/library" as const,
        icon: (
          <LibraryBig className="text-sidebar-foreground dark:text-sidebar-foreground short:size-5 h-6 w-6 flex-shrink-0" />
        ),
      },
    ];
  }, [animaId, newChatAnimaId, t]);
  const searchLink = {
    label: t("links.search"),
    href: "#" as const,
    onClick: openSearch,
    icon: (
      <Search className="text-sidebar-foreground dark:text-sidebar-foreground short:size-5 h-6 w-6 flex-shrink-0" />
    ),
  };

  return (
    <Sidebar open={open} setOpen={setOpen} animate={animate}>
      <SidebarBody className="justify-between gap-2">
        <div className="sidebar-scrollbar-hover flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <SidebarHeader onSearch={openSearch} />
          <div className="short:mt-2 mt-5 flex flex-col gap-1">
            {sidebarLinks.slice(0, 1).map((link) => (
              <SidebarLink key={link.label} link={link} />
            ))}
            {!open ? <SidebarLink link={searchLink} /> : null}
            {sidebarLinks.slice(1).map((link) => (
              <SidebarLink key={link.label} link={link} />
            ))}
            <SidebarCreateMenu />
          </div>
          <SidebarAnimas />
          <SidebarChats />
        </div>
        <SidebarUserMenu />
      </SidebarBody>
      <ChatSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </Sidebar>
  );
}
