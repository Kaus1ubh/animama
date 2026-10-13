"use client";

import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import { cn } from "@/lib/utils";
import { getAnimaDisplayName, sortAnimasByRecent } from "@/lib/anima-profile";
import { useSidebar } from "@/ui/sidebar/Sidebar";
import { SidebarSectionHeader } from "@/ui/sidebar/SidebarSectionHeader";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { useAnimas } from "@/query/hooks/useAnimas";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

type SidebarAnimaSort = "recent" | "name-asc" | "name-desc";

export { AnimaAvatar as SidebarAnimaAvatar } from "@animama/product-ui/components";
import {
  AnimaAvatar as SidebarAnimaAvatar,
  AnimaSelection,
} from "@animama/product-ui/components";

export const SidebarAnimas = () => {
  const { t } = useTranslation("sidebar");
  const { compare } = useFormatters();
  const { open } = useSidebar();
  const params = useParams({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const { userSettings } = useSettings();
  const [expanded, setExpanded] = useState(true);
  const [sort, setSort] = useState<SidebarAnimaSort>("recent");

  const currentAnimaId =
    typeof params?.animaId === "string" ? params.animaId : null;
  const liveAnimaId =
    currentAnimaId && !pathname.startsWith("/animas/") ? currentAnimaId : null;
  const recentlyUsedAnimaId =
    liveAnimaId ?? userSettings?.last_active_anima_id ?? null;

  const { data: animas = [], isLoading, isError } = useAnimas();
  const displayedAnimas = useMemo(() => {
    if (sort === "recent") {
      return sortAnimasByRecent(animas).sort((left, right) => {
        if (left.id === recentlyUsedAnimaId) return -1;
        if (right.id === recentlyUsedAnimaId) return 1;
        return 0;
      });
    }
    const direction = sort === "name-asc" ? 1 : -1;
    return [...animas].sort(
      (left, right) =>
        direction *
        compare(getAnimaDisplayName(left), getAnimaDisplayName(right)),
    );
  }, [animas, compare, recentlyUsedAnimaId, sort]);

  if (!open) {
    if (isLoading || isError || animas.length === 0) return null;

    return (
      <div className="mt-14 flex flex-col items-start gap-2">
        {displayedAnimas.map((anima) => {
          const displayName = getAnimaDisplayName(anima);
          const isActive = anima.id === currentAnimaId;
          const linkNode = (
            <Link
              key={anima.id}
              to="/$animaId"
              params={{ animaId: anima.id }}
              aria-label={displayName}
              className={cn(
                "border-border/60 bg-background/60 text-foreground/80 hover:bg-muted/70 hover:text-foreground flex h-11 w-11 items-center justify-center rounded-full border p-0 shadow-sm backdrop-blur-md transition-colors",
                isActive &&
                  "bg-sidebar-accent/80 text-foreground ring-sidebar-border/80 ring-1",
              )}
            >
              <SidebarAnimaAvatar
                anima={anima}
                displayName={displayName}
                isActive={isActive}
                variant="compact"
              />
            </Link>
          );

          return (
            <Tooltip key={anima.id}>
              <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {displayName}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className="group/sidebar-section mt-4">
      <SidebarSectionHeader
        label={t("animas.heading")}
        expanded={expanded}
        controlsId="sidebar-animas-list"
        filterActive={sort !== "recent"}
        filterLabel={t("animas.filter")}
        onToggle={() => setExpanded((prev) => !prev)}
      >
        <DropdownMenuLabel>{t("animas.sort.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => setSort(value as SidebarAnimaSort)}
        >
          <DropdownMenuRadioItem
            value="recent"
            className="focus:bg-muted focus:text-foreground"
          >
            {t("animas.sort.recent")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="name-asc"
            className="focus:bg-muted focus:text-foreground"
          >
            {t("animas.sort.nameAscending")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="name-desc"
            className="focus:bg-muted focus:text-foreground"
          >
            {t("animas.sort.nameDescending")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </SidebarSectionHeader>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="sidebar-animas-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1">
              {isLoading ? (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  {t("animas.loading")}
                </div>
              ) : isError ? (
                <div className="text-destructive px-2 py-2 text-xs">
                  {t("animas.loadFailed")}
                </div>
              ) : animas.length === 0 ? (
                <div className="text-muted-foreground px-2 py-2 text-xs">
                  {t("animas.empty")}
                </div>
              ) : (
                <AnimaSelection
                  animas={displayedAnimas}
                  selectedAnimaId={currentAnimaId}
                  renderItem={(anima, props) => (
                    <Link
                      to="/$animaId"
                      params={{ animaId: anima.id }}
                      {...props}
                    />
                  )}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
