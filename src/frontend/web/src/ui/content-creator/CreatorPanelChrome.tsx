"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

export type CreatorPanelCollapseDirection = "up" | "down";

/** Integrated vertical collapse control shared by creator panel headers. */
export function CreatorPanelCollapseButton({
  label,
  expanded,
  collapseDirection,
  onExpandedChange,
  className,
}: {
  label: string;
  expanded: boolean;
  collapseDirection: CreatorPanelCollapseDirection;
  onExpandedChange: (expanded: boolean) => void;
  className?: string;
}) {
  const Icon = expanded
    ? collapseDirection === "down"
      ? ChevronDownIcon
      : ChevronUpIcon
    : collapseDirection === "down"
      ? ChevronUpIcon
      : ChevronDownIcon;
  const { t } = useTranslation("creator");
  const action = expanded
    ? t("panel.collapse", { label })
    : t("panel.expand", { label });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground size-7 rounded-lg", className)}
          onClick={() => onExpandedChange(!expanded)}
          aria-label={action}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={collapseDirection === "down" ? "top" : "bottom"}>
        {action}
      </TooltipContent>
    </Tooltip>
  );
}

/** Compact, still-identifiable panel chrome used after a creator panel closes. */
export function CreatorCollapsedPanelHeader({
  label,
  summary,
  collapseDirection = "up",
  onExpand,
  actions,
  className,
}: {
  label: string;
  summary?: string;
  collapseDirection?: CreatorPanelCollapseDirection;
  onExpand: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border/65 bg-background pointer-events-auto flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2 shadow-xl",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{label}</h2>
        {summary ? (
          <p className="text-muted-foreground text-2xs truncate">{summary}</p>
        ) : null}
      </div>
      {actions}
      <CreatorPanelCollapseButton
        label={label}
        expanded={false}
        collapseDirection={collapseDirection}
        onExpandedChange={(expanded) => {
          if (expanded) onExpand();
        }}
      />
    </section>
  );
}
