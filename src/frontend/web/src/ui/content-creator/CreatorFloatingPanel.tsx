import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Translucent, creator-neutral surface for a floating setup or inspector panel. */
export function CreatorFloatingPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border/65 bg-background/92 rounded-2xl border p-4 shadow-xl shadow-black/8 backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
