import { type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { contentRowDescription } from "@/lib/content/libraryPresentation";
import { reactionIntensityLabel } from "@/lib/loadout/reactionLabels";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

export {
  reactionCellLabel,
  reactionIntensityLabel,
} from "@/lib/loadout/reactionLabels";

/** Shared selected-row treatment; adapters keep their own edit/equip behavior. */
export function ActionLoadoutRow({
  selected,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { selected: boolean }) {
  return (
    <div
      {...props}
      className={cn(
        "flex min-w-0 items-center gap-2.5 border-l-2 px-4 py-2",
        selected ? "border-l-primary bg-primary/5" : "border-l-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Shared compact identity: the row shows only the name, and the description
 * appears in a tooltip on hover or keyboard focus.
 */
export function ActionRowIdentity({
  name,
  description: rawDescription,
  badge,
}: {
  name: string;
  description: string | null;
  badge?: ReactNode;
}) {
  const description = contentRowDescription(rawDescription, name);
  const identity = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <p className="truncate text-sm font-medium">{name}</p>
      {badge}
    </div>
  );
  if (!description) return identity;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
        >
          {identity}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="max-w-sm text-left whitespace-normal"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

export function ReactionIntensityBadge({
  intensity,
}: {
  intensity: number | string;
}) {
  const { t } = useTranslation("animas");
  return (
    <span className="border-primary/15 bg-primary/8 text-primary inline-flex h-8 w-20 shrink-0 items-center justify-center rounded-md border px-2 text-xs font-medium">
      {reactionIntensityLabel(intensity, t)}
    </span>
  );
}
