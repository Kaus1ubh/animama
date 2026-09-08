"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SquareIcon,
  StepBackIcon,
  StepForwardIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { isAnimaPoseClipVFXEvent, type AnimaPoseClipEvent } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";
import { CreatorPanelCollapseButton } from "@/ui/action-editor/CreatorPanelChrome";
import {
  POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS,
  POSE_CREATOR_CLIP_SNAP_INTERVAL_OPTIONS,
  type PoseCreatorClipEventDraft,
  type PoseCreatorClipKeyframeDraft,
  type PoseCreatorClipPreviewDiagnostics,
} from "./poseCreatorClipAuthoring";
import { PoseCreatorClipAdvancedDialog } from "./PoseCreatorClipAdvancedDialog";

type TimelineDragState =
  | { kind: "playhead" }
  | {
      kind: "keyframe";
      keyframeId: string;
      pointerOffsetSec: number;
    }
  | {
      kind: "event";
      eventId: string;
      pointerOffsetSec: number;
    };

const RULER_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;
const TRACK_LABEL_RAIL_PX = 72;
const TRACK_RIGHT_INSET_PX = 16;
const TRACK_MARKER_WIDTH_PX = TRACK_LABEL_RAIL_PX + TRACK_RIGHT_INSET_PX;
const RULER_HEIGHT_PX = 32;
const LANE_HEIGHT_PX = 28;
const EVENT_MARKER_SIZE_PX = 16;
const EVENT_CLUSTER_OFFSET_STEP_PX = 8;

type TimelineEventLane = Extract<
  PoseCreatorClipEventDraft["kind"],
  "avatar_vfx" | "scene_vfx" | "particle_vfx" | "sfx"
>;

type EventMarkerLayout = {
  event: PoseCreatorClipEventDraft;
  lane: TimelineEventLane;
  offsetPx: number;
};

const TIMELINE_LANES: Array<{
  id: "pose" | TimelineEventLane;
  label: string;
}> = [
  { id: "pose", label: "Pose" },
  { id: "avatar_vfx", label: "Avatar" },
  { id: "scene_vfx", label: "Scene" },
  { id: "particle_vfx", label: "Particle" },
  { id: "sfx", label: "SFX" },
];

export function PoseCreatorClipTimeline({
  variant = "panel",
  poseLaneLabel = "Pose",
  playbackPending = false,
  onAddExpressionKeyframe,
  expanded = true,
  onExpandedChange,
}: {
  variant?: "panel" | "workspace" | "mobile";
  poseLaneLabel?: string;
  playbackPending?: boolean;
  onAddExpressionKeyframe?: () => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<TimelineDragState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const clipDraft = usePoseCreatorStore((state) => state.clipDraft);
  const clipSnapEnabled = usePoseCreatorStore((state) => state.clipSnapEnabled);
  const clipSnapIntervalSec = usePoseCreatorStore(
    (state) => state.clipSnapIntervalSec,
  );
  const clipPreviewDiagnostics = usePoseCreatorStore(
    (state) => state.clipPreviewDiagnostics,
  );
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const clipPlaybackPlaying = usePoseCreatorStore(
    (state) => state.clipPlaybackPlaying,
  );
  const clipPlaybackSpeed = usePoseCreatorStore(
    (state) => state.clipPlaybackSpeed,
  );
  const setClipCurrentTime = usePoseCreatorStore(
    (state) => state.setClipCurrentTime,
  );
  const setClipSnapEnabled = usePoseCreatorStore(
    (state) => state.setClipSnapEnabled,
  );
  const setClipSnapInterval = usePoseCreatorStore(
    (state) => state.setClipSnapInterval,
  );
  const selectClipKeyframe = usePoseCreatorStore(
    (state) => state.selectClipKeyframe,
  );
  const moveClipKeyframe = usePoseCreatorStore(
    (state) => state.moveClipKeyframe,
  );
  const selectClipEvent = usePoseCreatorStore((state) => state.selectClipEvent);
  const moveClipEvent = usePoseCreatorStore((state) => state.moveClipEvent);
  const beginClipUndoGroup = usePoseCreatorStore(
    (state) => state.beginClipUndoGroup,
  );
  const endClipUndoGroup = usePoseCreatorStore(
    (state) => state.endClipUndoGroup,
  );
  const nudgeSelectedClipEvent = usePoseCreatorStore(
    (state) => state.nudgeSelectedClipEvent,
  );
  const deleteSelectedClipEvent = usePoseCreatorStore(
    (state) => state.deleteSelectedClipEvent,
  );
  const playClipPreview = usePoseCreatorStore((state) => state.playClipPreview);
  const pauseClipPreview = usePoseCreatorStore(
    (state) => state.pauseClipPreview,
  );
  const stopClipPreview = usePoseCreatorStore((state) => state.stopClipPreview);
  const restartClipPreview = usePoseCreatorStore(
    (state) => state.restartClipPreview,
  );
  const setClipPlaybackSpeed = usePoseCreatorStore(
    (state) => state.setClipPlaybackSpeed,
  );
  const stepClipTime = usePoseCreatorStore((state) => state.stepClipTime);
  const stepClipKeyframe = usePoseCreatorStore(
    (state) => state.stepClipKeyframe,
  );
  const duration = Math.max(0, clipDraft.duration);
  const hasKeyframes = clipDraft.keyframes.length > 0;
  const hasPlayableContent = hasKeyframes || clipDraft.events.length > 0;
  const canPlayPreview =
    hasPlayableContent && duration > 0 && Boolean(activeAvatar);
  const playheadPercent = getTimelinePercent(
    clipDraft.currentTimeSec,
    duration,
  );
  const diagnosticSummary = getClipPreviewDiagnosticSummary(
    clipPreviewDiagnostics,
  );
  const validationErrorCount = clipDraft.validationIssues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const validationWarningCount = clipDraft.validationIssues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const eventMarkerLayouts = useMemo(
    () => buildEventMarkerLayouts(clipDraft.events, duration),
    [clipDraft.events, duration],
  );
  const ticks = useMemo(
    () =>
      RULER_TICKS.map((ratio) => ({
        ratio,
        time: duration * ratio,
        left: `${ratio * 100}%`,
      })),
    [duration],
  );

  useEffect(
    () => () => {
      if (
        dragRef.current?.kind === "keyframe" ||
        dragRef.current?.kind === "event"
      ) {
        usePoseCreatorStore.getState().endClipUndoGroup();
      }
    },
    [],
  );

  const getPointerTime = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || duration <= 0) return 0;
    const trackLeft = rect.left + TRACK_LABEL_RAIL_PX;
    const trackWidth = Math.max(
      1,
      rect.width - TRACK_LABEL_RAIL_PX - TRACK_RIGHT_INSET_PX,
    );
    const ratio = Math.min(1, Math.max(0, (clientX - trackLeft) / trackWidth));
    return ratio * duration;
  };

  const scrubToPointer = (clientX: number) => {
    setClipCurrentTime(getPointerTime(clientX), { snap: true });
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { kind: "playhead" };
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubToPointer(event.clientX);
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.kind !== "playhead") return;
    if (event.buttons === 0) {
      dragRef.current = null;
      return;
    }
    scrubToPointer(event.clientX);
  };

  const handleTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    releasePointerCapture(event);
  };

  const handleKeyframePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    keyframe: PoseCreatorClipKeyframeDraft,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const pointerTime = getPointerTime(event.clientX);
    dragRef.current = {
      kind: "keyframe",
      keyframeId: keyframe.id,
      pointerOffsetSec: keyframe.time - pointerTime,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    selectClipKeyframe(keyframe.id);
    beginClipUndoGroup();
  };

  const handleKeyframePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (drag?.kind !== "keyframe") return;
    if (event.buttons === 0) {
      endClipUndoGroup();
      dragRef.current = null;
      return;
    }
    moveClipKeyframe(
      drag.keyframeId,
      getPointerTime(event.clientX) + drag.pointerOffsetSec,
      { snap: true },
    );
  };

  const handleKeyframePointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    endClipUndoGroup();
    dragRef.current = null;
    releasePointerCapture(event);
  };

  const handleEventPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    clipEvent: PoseCreatorClipEventDraft,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const pointerTime = getPointerTime(event.clientX);
    dragRef.current = {
      kind: "event",
      eventId: clipEvent.id,
      pointerOffsetSec: clipEvent.time - pointerTime,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    selectClipEvent(clipEvent.id);
    beginClipUndoGroup();
  };

  const handleEventPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (drag?.kind !== "event") return;
    if (event.buttons === 0) {
      endClipUndoGroup();
      dragRef.current = null;
      return;
    }
    moveClipEvent(
      drag.eventId,
      getPointerTime(event.clientX) + drag.pointerOffsetSec,
      { snap: true },
    );
  };

  const handleEventPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    endClipUndoGroup();
    dragRef.current = null;
    releasePointerCapture(event);
  };

  const handleEventKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    clipEvent: PoseCreatorClipEventDraft,
  ) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selectClipEvent(clipEvent.id);
      nudgeSelectedClipEvent(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    selectClipEvent(clipEvent.id);
    if (
      window.confirm(
        `Delete ${formatEffectEventKind(clipEvent)} event ${clipEvent.id}?`,
      )
    ) {
      deleteSelectedClipEvent();
    }
  };

  return (
    <>
      <section
        className={cn(
          "border-border/70 bg-background w-full min-w-0 shrink-0 px-3 py-2",
          variant === "workspace"
            ? "h-full rounded-xl border shadow-lg"
            : variant === "mobile"
              ? "h-full min-h-0 overflow-y-auto border-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
              : "h-[384px] border-t lg:h-[352px]",
        )}
      >
        <div className="flex h-full min-w-0 flex-col gap-2">
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5">
            <div className="flex shrink-0 items-baseline gap-2">
              <h2 className="text-foreground text-sm font-semibold">
                Timeline
              </h2>
              <span
                className="text-muted-foreground text-xs"
                title={`${clipDraft.keyframes.length} keyframes / ${clipDraft.events.length} events`}
              >
                {clipDraft.keyframes.length}K · {clipDraft.events.length}E
              </span>
            </div>

            <div className="border-border/70 bg-muted/20 flex h-8 shrink-0 items-center rounded-md border p-0.5">
              <Button
                type="button"
                variant={clipPlaybackPlaying ? "secondary" : "ghost"}
                size="icon-sm"
                disabled={!canPlayPreview || playbackPending}
                onClick={
                  clipPlaybackPlaying ? pauseClipPreview : playClipPreview
                }
                aria-label={
                  clipPlaybackPlaying
                    ? "Pause clip preview"
                    : "Play clip preview"
                }
                title={
                  playbackPending
                    ? "Loading preview resources"
                    : clipPlaybackPlaying
                      ? "Pause"
                      : "Play"
                }
              >
                {clipPlaybackPlaying ? (
                  <PauseIcon className="size-4" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!hasPlayableContent}
                onClick={stopClipPreview}
                aria-label="Stop clip preview"
                title="Stop"
              >
                <SquareIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canPlayPreview || playbackPending}
                onClick={restartClipPreview}
                aria-label="Restart clip preview"
                title="Restart"
              >
                <RotateCcwIcon className="size-4" />
              </Button>
            </div>

            <div className="border-border/70 bg-muted/20 flex h-8 shrink-0 items-center rounded-md border p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!hasKeyframes}
                onClick={() => stepClipKeyframe(-1)}
                aria-label="Previous keyframe"
                title="Previous keyframe"
              >
                <SkipBackIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={duration <= 0}
                onClick={() => stepClipTime(-1)}
                aria-label="Step backward one frame"
                title="Step backward"
              >
                <StepBackIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={duration <= 0}
                onClick={() => stepClipTime(1)}
                aria-label="Step forward one frame"
                title="Step forward"
              >
                <StepForwardIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!hasKeyframes}
                onClick={() => stepClipKeyframe(1)}
                aria-label="Next keyframe"
                title="Next keyframe"
              >
                <SkipForwardIcon className="size-4" />
              </Button>
            </div>

            <Select
              value={String(clipPlaybackSpeed)}
              onValueChange={(value) => setClipPlaybackSpeed(Number(value))}
            >
              <SelectTrigger
                className="h-8 w-16 shrink-0"
                size="sm"
                aria-label="Clip playback speed"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {onAddExpressionKeyframe ? (
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0"
                onClick={onAddExpressionKeyframe}
              >
                + Expression
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2"
              onClick={() => setAdvancedOpen(true)}
              title="Clip data"
            >
              Data <ChevronDownIcon className="size-3.5" />
            </Button>

            <span
              className={cn(
                "flex shrink-0 items-center text-xs",
                diagnosticSummary || validationErrorCount > 0
                  ? "text-destructive"
                  : validationWarningCount > 0
                    ? "text-amber-600"
                    : "text-emerald-600",
              )}
              title={
                diagnosticSummary ??
                (validationErrorCount > 0
                  ? `${validationErrorCount} validation errors`
                  : validationWarningCount > 0
                    ? `${validationWarningCount} warnings`
                    : "Ready")
              }
            >
              {diagnosticSummary ||
              validationErrorCount > 0 ||
              validationWarningCount > 0 ? (
                <AlertTriangleIcon className="size-3.5" />
              ) : (
                <CheckCircle2Icon className="size-3.5" />
              )}
              <span className="sr-only">
                {diagnosticSummary
                  ? "Preview issue"
                  : validationErrorCount > 0
                    ? `${validationErrorCount} errors`
                    : validationWarningCount > 0
                      ? `${validationWarningCount} warnings`
                      : "Ready"}
              </span>
            </span>

            <label className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground hidden text-xs font-medium 2xl:inline">
                Time
              </span>
              <Input
                className="h-8 w-20 text-sm"
                type="number"
                min={0}
                max={duration}
                step={0.01}
                value={clipDraft.currentTimeSec}
                onChange={(event) =>
                  setClipCurrentTime(Number(event.currentTarget.value))
                }
                aria-label="Clip timeline playhead time"
              />
            </label>

            <label className="bg-muted/20 flex h-8 shrink-0 items-center gap-2 rounded-md px-2">
              <span className="text-muted-foreground hidden text-xs font-medium 2xl:inline">
                Snap
              </span>
              <Switch
                checked={clipSnapEnabled}
                onCheckedChange={setClipSnapEnabled}
                aria-label="Toggle timeline snap"
              />
            </label>

            <Select
              value={String(clipSnapIntervalSec)}
              onValueChange={(value) => setClipSnapInterval(Number(value))}
            >
              <SelectTrigger
                className="h-8 w-20 shrink-0"
                size="sm"
                aria-label="Timeline snap interval"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {POSE_CREATOR_CLIP_SNAP_INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {variant === "workspace" && onExpandedChange ? (
              <CreatorPanelCollapseButton
                label="timeline"
                expanded={expanded}
                collapseDirection="down"
                onExpandedChange={onExpandedChange}
              />
            ) : null}
          </div>

          {expanded ? (
            <div className="min-h-[178px] w-full overflow-x-auto overscroll-x-contain rounded-md">
              <div
                ref={trackRef}
                className={cn(
                  "border-border/70 bg-muted/20 relative h-[176px] cursor-crosshair overflow-hidden rounded-md border",
                  variant === "mobile" && "min-w-[680px] touch-pan-x",
                )}
                onPointerDown={handleTrackPointerDown}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerUp}
                onPointerCancel={handleTrackPointerUp}
              >
                <div className="pointer-events-none absolute top-0 right-[16px] left-[72px] h-8">
                  {ticks.map((tick) => (
                    <div
                      key={tick.ratio}
                      className="absolute top-2 flex -translate-x-1/2 flex-col items-center gap-1"
                      style={{ left: tick.left }}
                    >
                      <span className="bg-border/80 h-2 w-px" />
                      <span className="text-muted-foreground text-[10px] leading-none">
                        {formatTimelineTime(tick.time)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="bg-border pointer-events-none absolute top-8 bottom-3 left-[72px] w-px" />
                <div className="bg-border pointer-events-none absolute top-8 right-[16px] bottom-3 w-px" />

                {TIMELINE_LANES.map((lane, index) => (
                  <div
                    key={lane.id}
                    className="border-border/70 pointer-events-none absolute right-0 left-0 border-t"
                    style={{
                      top: RULER_HEIGHT_PX + index * LANE_HEIGHT_PX,
                      height: LANE_HEIGHT_PX,
                    }}
                  >
                    <div className="bg-background/95 text-muted-foreground sticky left-0 z-30 flex h-full w-[72px] items-center px-2 text-[10px] font-medium tracking-normal uppercase backdrop-blur-sm">
                      <span className="truncate">
                        {lane.id === "pose" ? poseLaneLabel : lane.label}
                      </span>
                    </div>
                    <div className="bg-border/80 absolute top-1/2 right-[16px] left-[72px] h-px -translate-y-1/2" />
                  </div>
                ))}

                {clipDraft.keyframes.map((keyframe) => (
                  <KeyframeMarker
                    key={keyframe.id}
                    duration={duration}
                    keyframe={keyframe}
                    selected={keyframe.id === clipDraft.selectedKeyframeId}
                    onPointerDown={handleKeyframePointerDown}
                    onPointerMove={handleKeyframePointerMove}
                    onPointerUp={handleKeyframePointerUp}
                    mobile={variant === "mobile"}
                  />
                ))}

                {eventMarkerLayouts.map((layout) => (
                  <EventMarker
                    key={layout.event.id}
                    duration={duration}
                    event={layout.event}
                    lane={layout.lane}
                    offsetPx={layout.offsetPx}
                    selected={layout.event.id === clipDraft.selectedEventId}
                    onFocus={() => selectClipEvent(layout.event.id)}
                    onPointerDown={handleEventPointerDown}
                    onPointerMove={handleEventPointerMove}
                    onPointerUp={handleEventPointerUp}
                    onKeyDown={handleEventKeyDown}
                    mobile={variant === "mobile"}
                  />
                ))}

                <div
                  className="bg-primary pointer-events-none absolute top-8 bottom-3 z-20 w-px"
                  style={{
                    left: getTimelineLeftStyle(playheadPercent),
                  }}
                >
                  <span className="bg-primary absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <PoseCreatorClipAdvancedDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      />
    </>
  );
}

function KeyframeMarker({
  keyframe,
  duration,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  mobile,
}: {
  keyframe: PoseCreatorClipKeyframeDraft;
  duration: number;
  selected: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    keyframe: PoseCreatorClipKeyframeDraft,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  mobile: boolean;
}) {
  const percent = getTimelinePercent(keyframe.time, duration);

  return (
    <button
      type="button"
      className={cn(
        "focus-visible:ring-ring absolute z-10 -translate-x-1/2 rotate-45 rounded-[2px] border text-[0px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
        mobile ? "size-5" : "size-4",
        selected
          ? "border-primary bg-primary/25 ring-primary/25 ring-2"
          : "hover:border-primary/70 hover:bg-primary/10 border-sky-300 bg-sky-100 dark:bg-sky-900/50",
      )}
      style={{
        top:
          getTimelineLaneCenterPx("pose") -
          (mobile ? 20 : EVENT_MARKER_SIZE_PX) / 2,
        left: getTimelineLeftStyle(percent),
      }}
      aria-label={`${keyframe.pose} keyframe at ${formatTimelineTime(
        keyframe.time,
      )}`}
      title={`${keyframe.pose} / ${formatTimelineTime(keyframe.time)}`}
      onPointerDown={(event) => onPointerDown(event, keyframe)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="text-muted-foreground pointer-events-none absolute top-4 left-1/2 w-28 -translate-x-1/2 -rotate-45 truncate text-center text-[10px]">
        {formatTimelinePoseLabel(keyframe.pose)}
      </span>
    </button>
  );
}

function EventMarker({
  event,
  duration,
  lane,
  offsetPx,
  selected,
  onFocus,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  mobile,
}: {
  event: PoseCreatorClipEventDraft;
  duration: number;
  lane: TimelineEventLane;
  offsetPx: number;
  selected: boolean;
  onFocus: () => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    clipEvent: PoseCreatorClipEventDraft,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    clipEvent: PoseCreatorClipEventDraft,
  ) => void;
  mobile: boolean;
}) {
  const percent = getTimelinePercent(event.time, duration);
  const title = formatEventMarkerTitle(event);

  return (
    <button
      type="button"
      className={cn(
        "focus-visible:ring-ring absolute z-10 -translate-x-1/2 border text-[0px] shadow-sm transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        selected ? "ring-ring ring-offset-background ring-2 ring-offset-2" : "",
        mobile && "min-h-5 min-w-5",
        getEventMarkerClassName(event),
      )}
      style={{
        top:
          getTimelineLaneCenterPx(lane) -
          (mobile ? 20 : EVENT_MARKER_SIZE_PX) / 2,
        left: getTimelineLeftStyle(percent, offsetPx),
      }}
      aria-label={title}
      title={title}
      onFocus={onFocus}
      onPointerDown={(pointerEvent) => onPointerDown(pointerEvent, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(keyboardEvent) => onKeyDown(keyboardEvent, event)}
    >
      {event.id}
    </button>
  );
}

function buildEventMarkerLayouts(
  events: readonly PoseCreatorClipEventDraft[],
  duration: number,
): EventMarkerLayout[] {
  const lanes = new Map<TimelineEventLane, PoseCreatorClipEventDraft[]>();
  for (const event of events) {
    const lane = getEventLane(event);
    lanes.set(lane, [...(lanes.get(lane) ?? []), event]);
  }

  return Array.from(lanes.entries()).flatMap(([lane, laneEvents]) => {
    const groups = new Map<string, PoseCreatorClipEventDraft[]>();
    for (const event of laneEvents) {
      const groupKey = `${lane}:${event.time.toFixed(3)}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), event]);
    }

    return Array.from(groups.values()).flatMap((group) =>
      group.map((event, index) => ({
        event,
        lane,
        offsetPx: getEventClusterOffsetPx(
          index,
          group.length,
          event.time,
          duration,
        ),
      })),
    );
  });
}

function getEventClusterOffsetPx(
  index: number,
  count: number,
  time: number,
  duration: number,
): number {
  if (count <= 1) return 0;
  if (duration <= 0) return index * EVENT_CLUSTER_OFFSET_STEP_PX;

  const ratio = Math.min(1, Math.max(0, time / duration));
  if (ratio <= 0.02) return index * EVENT_CLUSTER_OFFSET_STEP_PX;
  if (ratio >= 0.98) return (index - count + 1) * EVENT_CLUSTER_OFFSET_STEP_PX;
  return (index - (count - 1) / 2) * EVENT_CLUSTER_OFFSET_STEP_PX;
}

function getEventLane(event: PoseCreatorClipEventDraft): TimelineEventLane {
  if (event.kind === "avatar_vfx") return "avatar_vfx";
  if (event.kind === "scene_vfx") return "scene_vfx";
  if (event.kind === "particle_vfx") return "particle_vfx";
  return "sfx";
}

function getTimelineLaneCenterPx(lane: "pose" | TimelineEventLane): number {
  const laneIndex = TIMELINE_LANES.findIndex((candidate) => {
    return candidate.id === lane;
  });
  return (
    RULER_HEIGHT_PX +
    Math.max(0, laneIndex) * LANE_HEIGHT_PX +
    LANE_HEIGHT_PX / 2
  );
}

function getTimelineLeftStyle(percent: number, offsetPx = 0): string {
  const offset =
    offsetPx === 0
      ? ""
      : offsetPx > 0
        ? ` + ${offsetPx}px`
        : ` - ${Math.abs(offsetPx)}px`;
  return `calc(${TRACK_LABEL_RAIL_PX}px + (100% - ${TRACK_MARKER_WIDTH_PX}px) * ${
    percent / 100
  }${offset})`;
}

function getEventMarkerClassName(event: PoseCreatorClipEventDraft): string {
  if (event.kind === "avatar_vfx") {
    return "size-4 rounded-full border-emerald-300 bg-emerald-500 hover:border-emerald-100 hover:bg-emerald-400";
  }
  if (event.kind === "scene_vfx") {
    return "size-4 rounded-[4px] border-amber-300 bg-amber-500 hover:border-amber-100 hover:bg-amber-400";
  }
  if (event.kind === "particle_vfx") {
    return "size-4 rotate-45 rounded-[3px] border-violet-300 bg-violet-500 hover:border-violet-100 hover:bg-violet-400";
  }
  return "size-4 rounded-full border-sky-300 bg-sky-500 hover:border-sky-100 hover:bg-sky-400";
}

function formatEffectEventKind(event: AnimaPoseClipEvent): string {
  if (event.kind === "avatar_vfx") return "Avatar VFX";
  if (event.kind === "scene_vfx") {
    return event.sceneKind === "background_layers"
      ? "Scene VFX background"
      : "Scene VFX focus";
  }
  if (event.kind === "particle_vfx") return "Particle VFX";
  return "SFX";
}

function formatEffectEventCatalogId(event: AnimaPoseClipEvent): string {
  if (event.kind === "avatar_vfx") return event.effectId;
  if (event.kind === "scene_vfx") return event.presetId;
  if (event.kind === "particle_vfx") return event.effectId;
  return event.cueId;
}

function formatEventMarkerTitle(event: PoseCreatorClipEventDraft): string {
  const parts = [
    formatEffectEventKind(event),
    event.id,
    formatEffectEventCatalogId(event),
    formatTimelineTime(event.time),
  ];
  if (isAnimaPoseClipVFXEvent(event) && event.duration !== undefined) {
    parts.push(`duration ${formatTimelineTime(event.duration)}`);
  }
  return parts.join(" / ");
}

function getClipPreviewDiagnosticSummary(
  diagnostics: PoseCreatorClipPreviewDiagnostics,
): string | null {
  const parts: string[] = [];
  if (diagnostics.missingPoseRefs.length > 0) {
    parts.push(`Missing poses: ${diagnostics.missingPoseRefs.join(", ")}`);
  }
  if (diagnostics.missingAvatarVFXIds.length > 0) {
    parts.push(
      `Missing avatar VFX: ${diagnostics.missingAvatarVFXIds.join(", ")}`,
    );
  }
  if (diagnostics.missingSceneVFXPresetIds.length > 0) {
    parts.push(
      `Missing scene VFX: ${diagnostics.missingSceneVFXPresetIds.join(", ")}`,
    );
  }
  if (diagnostics.missingParticleVFXIds.length > 0) {
    parts.push(
      `Missing particle VFX: ${diagnostics.missingParticleVFXIds.join(", ")}`,
    );
  }
  if (diagnostics.missingSFXCueIds.length > 0) {
    parts.push(`Missing SFX: ${diagnostics.missingSFXCueIds.join(", ")}`);
  }
  parts.push(...diagnostics.eventAdapterWarnings);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function getTimelinePercent(time: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

function formatTimelineTime(time: number): string {
  if (!Number.isFinite(time)) return "0.00s";
  return `${time.toFixed(2)}s`;
}

function formatTimelinePoseLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function releasePointerCapture(
  event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}
