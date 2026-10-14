import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/components/input";

import {
  CreatorTimelineLane,
  CreatorTimelineRuler,
  CreatorTimelineToolbar,
  CreatorTimelineTransport,
} from "./CreatorTimeline";
import {
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
} from "./creatorTimelineGeometry";

type CompactPreviewProps = {
  children?: never;
  title?: string;
  subtitle: string;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onRestart: () => void;
  progressClassName?: string;
  duration: {
    value: number | null;
    label?: string;
    indefiniteLabel?: string;
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
  const { t } = useTranslation("creator");
  const {
    title = t("preview.title"),
    subtitle,
    playing,
    onPlayingChange,
    onRestart,
    progressClassName,
    duration,
  } = props;
  const durationLabel = duration.label ?? t("preview.duration");
  const indefiniteLabel = duration.indefiniteLabel ?? t("preview.untilStopped");
  return (
    <div className="flex h-full min-w-0 flex-col gap-2">
      <CreatorTimelineToolbar
        leading={
          duration.value === null ? (
            <span className="text-muted-foreground text-xs">
              {indefiniteLabel}
            </span>
          ) : (
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground whitespace-nowrap">
                {durationLabel}
              </span>
              <Input
                className="h-8 w-20 text-xs"
                aria-label={t("preview.durationSeconds", {
                  label: durationLabel,
                })}
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
              <span className="text-muted-foreground">
                {duration.unit ?? t("preview.secondsUnit")}
              </span>
            </label>
          )
        }
        transport={
          <CreatorTimelineTransport
            label={t("preview.target")}
            playing={playing}
            onTogglePlayback={() => onPlayingChange(!playing)}
            onStop={() => onPlayingChange(false)}
            onRestart={onRestart}
          />
        }
        trailing={
          <span className="text-muted-foreground text-xs">
            {playing ? t("preview.playing") : t("preview.stopped")}
          </span>
        }
      />
      <div className="min-h-[76px] overflow-x-auto rounded-md">
        <div className="border-border/70 bg-muted/20 relative h-[76px] min-w-80 overflow-hidden rounded-md border">
          {/* These routes have no elapsed clock: the ruler shows saved lifetime configuration. */}
          {duration.value !== null ? (
            <CreatorTimelineRuler durationSec={duration.value} />
          ) : (
            <span
              className="text-muted-foreground text-2xs absolute top-2"
              style={{ left: TRACK_LABEL_RAIL_PX }}
            >
              {indefiniteLabel}
            </span>
          )}
          <CreatorTimelineLane index={0} label={title}>
            <div
              className={cn(
                "bg-primary/15 text-foreground text-2xs absolute top-1 bottom-1 truncate rounded px-2 leading-[18px]",
                playing && progressClassName,
              )}
              style={{ left: TRACK_LABEL_RAIL_PX, right: TRACK_RIGHT_INSET_PX }}
              title={subtitle}
            >
              {subtitle}
            </div>
          </CreatorTimelineLane>
        </div>
      </div>
    </div>
  );
}
