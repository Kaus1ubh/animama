import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CreatorPanelCollapseButton } from "./CreatorPanelChrome";

/** Translucent, creator-neutral surface for a floating setup or inspector panel. */
export function CreatorFloatingPanel({
  className,
  children,
  title,
  summary,
  headerActions,
  bodyClassName,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
  summary?: string;
  headerActions?: ReactNode;
  bodyClassName?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "border-border/65 bg-background flex min-h-0 flex-col rounded-2xl border shadow-xl shadow-black/8",
        title ? "h-full" : "p-3",
        className,
        title && "p-0",
        title && !expanded && "h-auto shrink-0",
      )}
    >
      {title ? (
        <>
          <header className="flex min-h-12 shrink-0 items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-sm font-semibold">
                {title}
              </h2>
              {summary ? (
                <p className="text-muted-foreground text-2xs truncate">
                  {summary}
                </p>
              ) : null}
            </div>
            {headerActions}
            <CreatorPanelCollapseButton
              label={title.toLowerCase()}
              expanded={expanded}
              collapseDirection="up"
              onExpandedChange={setExpanded}
            />
          </header>
          <div
            hidden={!expanded}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-3 pt-0",
              bodyClassName,
              !expanded && "hidden",
            )}
          >
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </section>
  );
}
