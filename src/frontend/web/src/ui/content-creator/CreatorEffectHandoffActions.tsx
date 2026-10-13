"use client";

import { Link } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  HeartPulseIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ActionComponentType } from "@/query/hooks/useEffects";
import { Button } from "@/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";

export function effectCreatorHandoffSearch(
  itemId: string,
  componentType: ActionComponentType,
) {
  return { component: itemId, componentType } as const;
}

/** Stable-ID-only post-save handoff shared by every component creator. */
export function CreatorEffectHandoffActions({
  itemId,
  componentType,
}: {
  itemId: string | null | undefined;
  componentType: ActionComponentType;
}) {
  const { t } = useTranslation("creator");
  if (!itemId) return null;
  const search = effectCreatorHandoffSearch(itemId, componentType);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="bg-background dark:bg-background dark:hover:bg-accent h-11 rounded-xl shadow-sm"
        >
          <WandSparklesIcon />
          <span className="hidden xl:inline">{t("handoff.useIn")}</span>
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem asChild>
          <Link to="/gestures/new" search={search}>
            <WandSparklesIcon className="mr-2 size-4" />
            {t("handoff.gesture")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/reactions/new" search={search}>
            <HeartPulseIcon className="mr-2 size-4" />
            {t("handoff.reaction")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
