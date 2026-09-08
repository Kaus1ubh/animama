import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";

export type CreatorSelectOption = {
  value: string;
  label: string;
};

export type CreatorCanvasSelect = {
  label: string;
  value: string;
  placeholder?: string;
  options: readonly CreatorSelectOption[];
  onValueChange: (value: string) => void;
  triggerClassName?: string;
  disabled?: boolean;
};

/** Shared Model/View/Guides/Restart chrome with one bounded domain slot. */
export function CreatorCanvasControls({
  model,
  view,
  guides,
  guidesLabel = "Guides",
  guidesAriaLabel = "Show placement guides",
  guidesDisabled,
  onGuidesChange,
  domainControl,
  restartDisabled,
  onRestart,
  className,
}: {
  model?: CreatorCanvasSelect;
  view?: CreatorCanvasSelect;
  guides: boolean;
  guidesLabel?: string;
  guidesAriaLabel?: string;
  guidesDisabled?: boolean;
  onGuidesChange: (checked: boolean) => void;
  domainControl?: ReactNode;
  restartDisabled?: boolean;
  onRestart: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background/88 border-border/70 flex max-w-full items-center gap-2 overflow-x-auto rounded-xl border p-2 shadow-lg backdrop-blur-xl",
        className,
      )}
    >
      {model ? <CreatorCanvasSelectControl control={model} /> : null}
      {model && view ? <span className="bg-border h-5 w-px shrink-0" /> : null}
      {view ? <CreatorCanvasSelectControl control={view} /> : null}
      <Switch
        checked={guides}
        disabled={guidesDisabled}
        onCheckedChange={onGuidesChange}
        aria-label={guidesAriaLabel}
      />
      <span className="text-muted-foreground shrink-0 text-xs">
        {guidesLabel}
      </span>
      {domainControl}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={restartDisabled}
        onClick={onRestart}
      >
        <RefreshCwIcon /> Restart
      </Button>
    </div>
  );
}

function CreatorCanvasSelectControl({
  control,
}: {
  control: CreatorCanvasSelect;
}) {
  return (
    <>
      <span className="text-muted-foreground shrink-0 pl-1 text-xs">
        {control.label}
      </span>
      <Select
        value={control.value}
        onValueChange={control.onValueChange}
        disabled={control.disabled}
      >
        <SelectTrigger
          className={cn(
            "h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
            control.triggerClassName,
          )}
        >
          <SelectValue placeholder={control.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {control.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
