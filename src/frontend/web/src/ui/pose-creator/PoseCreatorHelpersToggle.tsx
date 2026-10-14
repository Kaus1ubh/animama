"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("pose");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn(
            "bg-background size-11 shrink-0 rounded-lg shadow-none lg:size-9",
            checked && "border-primary/40 bg-primary/8 text-primary",
          )}
          onClick={() => onCheckedChange(!checked)}
          aria-label={checked ? t("helpers.hide") : t("helpers.show")}
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
        {t("helpers.tooltip")}
      </TooltipContent>
    </Tooltip>
  );
}
