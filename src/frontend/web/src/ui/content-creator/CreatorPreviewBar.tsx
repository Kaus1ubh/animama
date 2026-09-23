import { PauseIcon, PlayIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";

type CompactPreviewProps = {
  children?: never;
  title?: string;
  subtitle: string;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onRestart: () => void;
  progressClassName?: string;
  duration: {
    value: number;
    disabled?: boolean;
    min: number;
    max: number;
    step: number;
    onValueChange: (value: number) => void;
    unit?: string;
  };
};

type ComposedPreviewProps = {
  children: ReactNode;
  title?: never;
  subtitle?: never;
  playing?: never;
  onPlayingChange?: never;
  onRestart?: never;
  progressClassName?: never;
  duration?: never;
};

/** Common bordered bottom surface for compact or creator-owned preview chrome. */
export function CreatorPreviewBar({
  className,
  ...props
}: (CompactPreviewProps | ComposedPreviewProps) & { className?: string }) {
  return (
    <section
      className={cn(
        "bg-background border-border/70 min-h-14 rounded-2xl border p-3 shadow-sm lg:h-full lg:overflow-hidden",
        className,
      )}
    >
      {isCompactPreview(props) ? (
        <CompactPreviewContent {...props} />
      ) : (
        props.children
      )}
    </section>
  );
}

function isCompactPreview(
  props: CompactPreviewProps | ComposedPreviewProps,
): props is CompactPreviewProps {
  return typeof props.subtitle === "string";
}

function CompactPreviewContent(props: CompactPreviewProps) {
  const {
    title = "Preview",
    subtitle,
    playing,
    onPlayingChange,
    onRestart,
    progressClassName,
    duration,
  } = props;
  return (
    <div className="flex h-full flex-wrap items-center gap-3">
      <div className="mr-auto max-w-48 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </div>
      <div className="border-border/70 bg-muted/20 flex shrink-0 items-center rounded-lg border p-0.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? "Pause preview" : "Play preview"}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => onPlayingChange(false)}
          aria-label="Stop preview"
          title="Stop"
        >
          <SquareIcon />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRestart}
          aria-label="Restart preview"
          title="Restart"
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="bg-muted/55 mx-1 hidden h-1 min-w-20 flex-1 overflow-hidden rounded-full sm:block">
        <div
          className={cn(
            "bg-primary h-full w-full origin-left",
            playing && progressClassName,
          )}
        />
      </div>
      <label className="ml-auto flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Duration</span>
        <Input
          className="h-8 w-20 text-xs"
          aria-label="Preview duration in seconds"
          type="number"
          min={duration.min}
          max={duration.max}
          step={duration.step}
          value={duration.value}
          disabled={duration.disabled}
          onChange={(event) =>
            duration.onValueChange(event.target.valueAsNumber)
          }
        />
        <span className="text-muted-foreground text-xs">
          {duration.unit ?? "s"}
        </span>
      </label>
    </div>
  );
}
