"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

type PromptSuggestionProps = ComponentProps<typeof Button>;

export function PromptSuggestion({
  className,
  type = "button",
  variant = "ghost",
  ...props
}: PromptSuggestionProps) {
  return (
    <Button
      type={type}
      variant={variant}
      className={cn(
        "border-border/70 bg-background/65 text-foreground/85 hover:bg-background/80 hover:text-foreground h-7 rounded-full border px-3 text-[13px] font-medium shadow-sm backdrop-blur-xs transition-colors",
        className,
      )}
      {...props}
    />
  );
}
