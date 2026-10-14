import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * True while a sticky header is pinned to its scroll container's top. A
 * sentinel just above the header leaves the container's top edge when the
 * header starts to stick.
 */
function useStuck(enabled: boolean) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || !sentinel || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(
          Boolean(
            entry &&
            !entry.isIntersecting &&
            entry.rootBounds &&
            entry.boundingClientRect.top < entry.rootBounds.top,
          ),
        ),
      { root: scrollParent(sentinel) },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled]);
  return { sentinelRef, stuck: enabled && stuck };
}

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
  // Only cover scrolled content while pinned; at rest the header shares the
  // panel's own (possibly translucent) surface.
  const { sentinelRef, stuck } = useStuck(sticky && expanded);
  return (
    <section className="relative space-y-4" aria-labelledby={headingId}>
      {sticky ? (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
        />
      ) : null}
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          sticky && "sticky top-0 z-20 rounded-lg transition-colors",
          stuck && "bg-card/95 backdrop-blur-sm",
        )}
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
