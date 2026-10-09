"use client";

import { Slot } from "@radix-ui/react-slot";
import { useId, type ComponentProps, type ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

/**
 * Present a familiar action that the runtime withholds, with a short reason.
 *
 * The child control stays visible and focusable but is marked `aria-disabled`,
 * so pointer and keyboard users can still discover why it is unavailable. The
 * caller renders it without a link or handler, so activating it starts nothing.
 * The reason appears in a tooltip on hover or focus and is announced as the
 * control's accessible description.
 */
export function UnavailableAction({
  reason,
  side,
  children,
}: {
  reason: string;
  side?: ComponentProps<typeof TooltipContent>["side"];
  /** One inert control (for example a `type="button"` button). */
  children: ReactElement;
}) {
  const reasonId = useId();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Slot
            aria-disabled="true"
            aria-describedby={reasonId}
            className="cursor-not-allowed opacity-50"
          >
            {children}
          </Slot>
        </TooltipTrigger>
        {/* Above sidebar menus (z-[130]) so the reason stays readable anywhere. */}
        <TooltipContent side={side} className="z-[140] max-w-64">
          {reason}
        </TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
  );
}
