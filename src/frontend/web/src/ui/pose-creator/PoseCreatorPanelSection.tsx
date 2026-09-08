"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

type PoseCreatorPanelSectionProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  openRequestKey?: number | string | null;
  className?: string;
  contentClassName?: string;
};

export function PoseCreatorPanelSection({
  title,
  subtitle,
  actions,
  children,
  defaultOpen = false,
  openRequestKey = null,
  className,
  contentClassName,
}: PoseCreatorPanelSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = isOpen ? ChevronDownIcon : ChevronRightIcon;

  useEffect(() => {
    if (openRequestKey === null) return;
    setIsOpen(true);
  }, [openRequestKey]);

  return (
    <section className={cn("border-border/70 border-b", className)}>
      <div className="flex items-start gap-2 px-4 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="hover:text-foreground text-foreground flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left transition-colors"
              aria-expanded={isOpen}
              onClick={() => setIsOpen((value) => !value)}
            >
              <Icon
                className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 text-sm font-medium">{title}</span>
            </button>
          </TooltipTrigger>
          {subtitle ? (
            <TooltipContent side="bottom" sideOffset={6}>
              {subtitle}
            </TooltipContent>
          ) : null}
        </Tooltip>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      {isOpen ? (
        <div className={cn("space-y-3 px-4 pb-4", contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
