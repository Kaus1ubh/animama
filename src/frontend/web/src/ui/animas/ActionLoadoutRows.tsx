import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { contentRowDescription } from "@/lib/content/libraryPresentation";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

/** Shared selected-row treatment; adapters keep their own edit/equip behavior. */
export function ActionLoadoutRow({
  selected,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { selected: boolean }) {
  return (
    <div
      {...props}
      className={cn(
        "flex min-w-0 items-center gap-2.5 border-l-2 px-4 py-3.5",
        selected ? "border-l-primary bg-primary/5" : "border-l-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Shared compact identity with a tooltip only when its description is clipped. */
export function ActionRowIdentity({
  name,
  description: rawDescription,
  badge,
}: {
  name: string;
  description: string | null;
  badge?: ReactNode;
}) {
  const description = contentRowDescription(rawDescription, name);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) {
      setTruncated(false);
      return;
    }
    const measure = () =>
      setTruncated(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={truncated ? 0 : undefined}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">{name}</p>
            {badge}
          </div>
          {description ? (
            <p
              ref={descriptionRef}
              className="text-muted-foreground truncate text-xs"
            >
              {description}
            </p>
          ) : null}
        </div>
      </TooltipTrigger>
      {truncated ? (
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-sm text-left whitespace-normal"
        >
          {description}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

export function reactionIntensityLabel(intensity: number | string): string {
  if (String(intensity) === "1") return "Mild";
  if (String(intensity) === "2") return "Moderate";
  if (String(intensity) === "3") return "Strong";
  return `Level ${intensity}`;
}

export function ReactionIntensityBadge({
  intensity,
}: {
  intensity: number | string;
}) {
  return (
    <span className="border-primary/15 bg-primary/8 text-primary inline-flex h-8 w-20 shrink-0 items-center justify-center rounded-md border px-2 text-xs font-medium">
      {reactionIntensityLabel(intensity)}
    </span>
  );
}
