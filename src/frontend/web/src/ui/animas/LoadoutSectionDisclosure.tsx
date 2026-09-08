import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** Shared collapsed-by-default shell for a top-level Anima Loadout section. */
export function LoadoutSectionDisclosure({
  title,
  headingId,
  contentId,
  expanded,
  onToggle,
  actions,
  sticky = false,
  children,
}: {
  title: string;
  headingId: string;
  contentId: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  sticky?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" aria-labelledby={headingId}>
      <div
        className={`flex items-center justify-between gap-3 ${
          sticky ? "bg-card/95 sticky top-0 z-20 backdrop-blur-sm" : ""
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={onToggle}
          className="hover:bg-muted/30 focus-visible:ring-ring flex min-w-0 flex-1 items-center justify-start gap-2 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2"
        >
          <span id={headingId} className="truncate text-lg font-semibold">
            {title}
          </span>
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
        </button>
        {expanded ? actions : null}
      </div>

      {expanded ? <div id={contentId}>{children}</div> : null}
    </section>
  );
}
