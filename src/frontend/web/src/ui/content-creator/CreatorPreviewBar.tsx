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
        "bg-background/92 border-border/70 h-full overflow-hidden rounded-2xl border p-3 shadow-xl backdrop-blur-xl",
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
    <div className="flex h-full flex-wrap items-center gap-2">
      <div className="mr-2 min-w-[110px]">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? "Pause preview" : "Play preview"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => onPlayingChange(false)}
        aria-label="Stop preview"
      >
        <SquareIcon />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={onRestart}
        aria-label="Restart preview"
      >
        <RefreshCwIcon />
      </Button>
      <div className="bg-muted/55 mx-1 hidden h-1 min-w-20 flex-1 overflow-hidden rounded-full sm:block">
        <div
          className={cn(
            "h-full w-full origin-left bg-sky-400",
            playing && progressClassName,
          )}
        />
      </div>
      <span className="text-muted-foreground ml-auto text-xs">Duration</span>
      <Input
        className="h-9 w-20"
        type="number"
        min={duration.min}
        max={duration.max}
        step={duration.step}
        value={duration.value}
        disabled={duration.disabled}
        onChange={(event) => duration.onValueChange(event.target.valueAsNumber)}
      />
      <span className="text-muted-foreground text-xs">
        {duration.unit ?? "seconds"}
      </span>
    </div>
  );
}
