import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import { getAnimaDisplayName } from "@/lib/anima-profile";
import { cn } from "@/lib/utils";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useSidebar } from "@/ui/sidebar/Sidebar";
import { SidebarAnimaAvatar } from "@/ui/sidebar/SidebarAnimas";
import { SidebarSectionHeader } from "@/ui/sidebar/SidebarSectionHeader";
import { useChats } from "@/query/hooks/useChats";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/ui/components/dropdown-menu";

const ALL_ANIMAS_FILTER = "all";

export const SidebarChats = () => {
  const { t } = useTranslation("sidebar");
  const { compare } = useFormatters();
  const params = useParams({ strict: false });
  const { open } = useSidebar();
  const [expanded, setExpanded] = useState(true);
  const [animaFilter, setAnimaFilter] = useState(ALL_ANIMAS_FILTER);
  const routeChatId = typeof params?.chatId === "string" ? params.chatId : null;
  const { data: animas = [] } = useAnimas({ enabled: open });
  const animasById = useMemo(
    () => new Map(animas.map((anima) => [anima.id, anima] as const)),
    [animas],
  );
  const { data: chats = [], isLoading, isError } = useChats({ enabled: open });
  const chatAnimas = useMemo(() => {
    const chatAnimaIds = new Set(chats.map((chat) => chat.anima_id));
    return animas
      .filter((anima) => chatAnimaIds.has(anima.id))
      .sort((left, right) =>
        compare(getAnimaDisplayName(left), getAnimaDisplayName(right)),
      );
  }, [animas, chats, compare]);
  const displayedChats = useMemo(
    () =>
      animaFilter === ALL_ANIMAS_FILTER
        ? chats
        : chats.filter((chat) => chat.anima_id === animaFilter),
    [animaFilter, chats],
  );

  useEffect(() => {
    if (
      animaFilter !== ALL_ANIMAS_FILTER &&
      !chatAnimas.some((anima) => anima.id === animaFilter)
    ) {
      setAnimaFilter(ALL_ANIMAS_FILTER);
    }
  }, [animaFilter, chatAnimas]);

  if (!open) return null;

  return (
    <div className="group/sidebar-section mt-4">
      <SidebarSectionHeader
        label={t("chats.heading")}
        expanded={expanded}
        controlsId="sidebar-chats-list"
        filterActive={animaFilter !== ALL_ANIMAS_FILTER}
        filterLabel={t("chats.filter")}
        onToggle={() => setExpanded((prev) => !prev)}
      >
        <DropdownMenuLabel>{t("chats.filterByAnima")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={animaFilter}
          onValueChange={setAnimaFilter}
        >
          <DropdownMenuRadioItem
            value={ALL_ANIMAS_FILTER}
            className="focus:bg-muted focus:text-foreground"
          >
            {t("chats.allAnimas")}
          </DropdownMenuRadioItem>
          {chatAnimas.map((anima) => (
            <DropdownMenuRadioItem
              key={anima.id}
              value={anima.id}
              className="focus:bg-muted focus:text-foreground"
            >
              {getAnimaDisplayName(anima)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SidebarSectionHeader>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="sidebar-chats-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1">
              {isLoading ? (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  {t("chats.loading")}
                </div>
              ) : isError ? (
                <div className="text-destructive px-2 py-2 text-xs">
                  {t("chats.loadFailed")}
                </div>
              ) : chats.length === 0 ? (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  {t("chats.empty")}
                </div>
              ) : displayedChats.length === 0 ? (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  {t("chats.emptyForAnima")}
                </div>
              ) : (
                displayedChats.map((chat) => {
                  const title = chat.title?.trim() || t("chats.untitled");
                  const isActive = chat.id === routeChatId;
                  const targetAnimaId = chat.anima_id;

                  if (!targetAnimaId) return null;
                  const anima = animasById.get(targetAnimaId);
                  const animaName = anima ? getAnimaDisplayName(anima) : null;

                  return (
                    <Link
                      key={chat.id}
                      to="/$animaId/c/$chatId"
                      params={{
                        animaId: targetAnimaId,
                        chatId: chat.id,
                      }}
                      title={title}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                        "text-foreground/90 hover:bg-sidebar-accent/60 transition-colors",
                        "overflow-hidden",
                        isActive && "bg-sidebar-accent text-foreground",
                      )}
                    >
                      {anima && animaName ? (
                        <SidebarAnimaAvatar
                          anima={anima}
                          displayName={animaName}
                          isActive={isActive}
                          variant="chat"
                        />
                      ) : null}
                      <span className="block min-w-0 flex-1 truncate transition duration-150 group-hover:translate-x-0.5">
                        {title}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
