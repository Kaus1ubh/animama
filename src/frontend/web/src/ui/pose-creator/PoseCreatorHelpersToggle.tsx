"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

type PoseCreatorHelpersToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Show the helper-node toggle with concise guidance for the canvas rotation gizmo. */
export function PoseCreatorHelpersToggle({
  checked,
  onCheckedChange,
}: PoseCreatorHelpersToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            "bg-background/70 size-11 shrink-0 rounded-lg shadow-none lg:size-9",
            checked && "border-primary/40 bg-primary/8 text-primary",
          )}
          onClick={() => onCheckedChange(!checked)}
          aria-label={
            checked ? "Hide bone helper nodes" : "Show bone helper nodes"
          }
          aria-pressed={checked}
        >
          {checked ? (
            <EyeIcon className="size-4" />
          ) : (
            <EyeOffIcon className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="max-w-[360px] leading-relaxed whitespace-normal"
      >
        Show bone markers and the selected bone’s rotation gizmo. Drag red,
        green, or blue for local X, Y, or Z rotation; yellow for view-axis
        rotation; or the center for free rotation. In Clip mode, pause playback
        and edit an inline pose to use the gizmo.
      </TooltipContent>
    </Tooltip>
  );
}
