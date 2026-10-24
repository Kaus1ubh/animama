import { PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  LANE_HEIGHT_PX,
  RULER_HEIGHT_PX,
  RULER_TICKS,
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
  formatTimelineTime,
  getTimelineLeftStyle,
  getTimelinePercent,
} from "./creatorTimelineGeometry";

/**
 * Shared control layout; each creator owns its playback state and
 * capabilities. Phone widths wrap the groups instead of clipping them.
 */
export function CreatorTimelineToolbar({
  leading,
  transport,
  trailing,
}: {
  leading: ReactNode;
  transport: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 shrink-0 grid-cols-[auto_auto_auto] items-center gap-1.5 overflow-x-auto pb-0.5 max-sm:flex max-sm:flex-wrap max-sm:overflow-visible min-[1200px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-3 justify-self-start">
        {leading}
      </div>
      <div className="col-start-2 row-start-1 flex items-center justify-center gap-1.5 max-sm:min-w-0 max-sm:flex-wrap max-sm:justify-start">
        {transport}
      </div>
      <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-1.5 justify-self-end max-sm:ml-auto">
        {trailing}
      </div>
    </div>
  );
}

/** Common transport buttons; disabling one capability never implies another. */
export function CreatorTimelineTransport({
  playing,
  onTogglePlayback,
  onStop,
  onRestart,
  playDisabled = false,
  stopDisabled = false,
  restartDisabled = false,
  label,
  pending = false,
}: {
  playing: boolean;
  onTogglePlayback: () => void;
  onStop: () => void;
  onRestart: () => void;
  playDisabled?: boolean;
  stopDisabled?: boolean;
  restartDisabled?: boolean;
  label?: string;
  pending?: boolean;
}) {
  const { t } = useTranslation("creator");
  const target = label ?? t("timeline.defaultTarget");
  return (
    <div className="border-border/70 bg-muted/20 flex h-8 shrink-0 items-center rounded-md border p-0.5">
      <Button
        type="button"
        variant={playing ? "secondary" : "ghost"}
        size="icon-sm"
        disabled={playDisabled || pending}
        onClick={onTogglePlayback}
        aria-label={
          playing
            ? t("timeline.pauseTarget", { target })
            : t("timeline.playTarget", { target })
        }
        title={
          pending
            ? t("timeline.loadingResources")
            : playing
              ? t("timeline.pause")
              : t("timeline.play")
        }
      >
        {playing ? (
          <PauseIcon className="size-4" />
        ) : (
          <PlayIcon className="size-4" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={stopDisabled}
        onClick={onStop}
        aria-label={t("timeline.stopTarget", { target })}
        title={t("timeline.stop")}
      >
        <SquareIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={restartDisabled || pending}
        onClick={onRestart}
        aria-label={t("timeline.restartTarget", { target })}
        title={t("timeline.restart")}
      >
        <RotateCcwIcon className="size-4" />
      </Button>
    </div>
  );
}

/** Absolute ruler and time bounds; the owning track supplies pointer behavior. */
export function CreatorTimelineRuler({
  durationSec,
  hideTick,
}: {
  durationSec: number;
  hideTick?: (timeSec: number) => boolean;
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute top-0 h-8"
        style={{ left: TRACK_LABEL_RAIL_PX, right: TRACK_RIGHT_INSET_PX }}
      >
        {RULER_TICKS.map((ratio) => (
          <div
            key={ratio}
            className="absolute top-2 flex -translate-x-1/2 flex-col items-center gap-1"
            style={{ left: `${ratio * 100}%` }}
          >
            <span className="bg-border/80 h-2 w-px" />
            <span
              className={cn(
                "text-muted-foreground text-2xs leading-none",
                hideTick?.(durationSec * ratio) && "invisible",
              )}
            >
              {formatTimelineTime(durationSec * ratio)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="bg-border pointer-events-none absolute top-8 bottom-3 w-px"
        style={{ left: TRACK_LABEL_RAIL_PX }}
      />
      <div
        className="bg-border pointer-events-none absolute top-8 bottom-3 w-px"
        style={{ right: TRACK_RIGHT_INSET_PX }}
      />
    </>
  );
}

/** Lane chrome retains marker geometry, with optional emitter selection on its label. */
export function CreatorTimelineLane({
  index,
  label,
  selected,
  onSelect,
  children,
}: {
  index: number;
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  const labelClassName =
    "bg-background text-muted-foreground sticky left-0 z-30 flex h-full items-center px-2 text-2xs font-medium tracking-normal uppercase backdrop-blur-sm";
  return (
    <div
      className={cn(
        "border-border/70 pointer-events-none absolute right-0 left-0 border-t",
        selected && "bg-primary/5",
      )}
      style={{
        top: RULER_HEIGHT_PX + index * LANE_HEIGHT_PX,
        height: LANE_HEIGHT_PX,
      }}
    >
      {onSelect ? (
        <button
          type="button"
          aria-label={label}
          aria-pressed={selected}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onSelect}
          className={cn(
            labelClassName,
            "focus-visible:ring-ring pointer-events-auto cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
            selected && "text-primary",
          )}
          style={{ width: TRACK_LABEL_RAIL_PX }}
        >
          <span className="pointer-events-auto truncate" title={label}>
            {label}
          </span>
        </button>
      ) : (
        <div className={labelClassName} style={{ width: TRACK_LABEL_RAIL_PX }}>
          <span className="pointer-events-auto truncate" title={label}>
            {label}
          </span>
        </div>
      )}
      <div
        className="bg-border/80 absolute top-1/2 h-px -translate-y-1/2"
        style={{ left: TRACK_LABEL_RAIL_PX, right: TRACK_RIGHT_INSET_PX }}
      />
      {children}
    </div>
  );
}

/** Playhead avoids duplicating ruler text; callers may hide it beneath drop labels. */
export function CreatorTimelinePlayhead({
  timeSec,
  durationSec,
  hideLabel = false,
}: {
  timeSec: number;
  durationSec: number;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation("creator");
  const percent = getTimelinePercent(timeSec, durationSec);
  const label = formatTimelineTime(timeSec);
  const repeatsTick = RULER_TICKS.some(
    (ratio) => formatTimelineTime(durationSec * ratio) === label,
  );
  return (
    <div
      className="bg-primary pointer-events-none absolute top-8 bottom-3 z-20 w-px"
      style={{ left: getTimelineLeftStyle(percent) }}
    >
      {!hideLabel && !repeatsTick ? (
        <span
          className={cn(
            "text-foreground text-2xs absolute -top-7 font-medium tabular-nums",
            percent > 95 ? "right-0" : "left-1/2 -translate-x-1/2",
          )}
          aria-label={t("timeline.playhead")}
        >
          {label}
        </span>
      ) : null}
      <span className="bg-primary absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" />
    </div>
  );
}
