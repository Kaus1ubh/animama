"use client";

import {
  Settings2Icon,
  Volume2Icon,
  VolumeXIcon,
  SkipBackIcon,
  SkipForwardIcon,
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
import { handleTimelineDeleteKey } from "./poseCreatorTimelineKeyboard";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseCreatorClipWorkspaceInspector } from "./PoseCreatorClipWorkspaceInspector";
import { Input } from "@/ui/components/input";
import { Button } from "@/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";
import { useCatalogTimelineDrop } from "@/ui/action-editor/ActionCatalogDrag";
import { timelinePointerTime } from "@/ui/action-editor/timelineCatalogDrop";
import { CreatorPanelCollapseButton } from "@/ui/action-editor/CreatorPanelChrome";
import {
  POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS,
  POSE_CREATOR_CLIP_SNAP_INTERVAL_OPTIONS,
  type PoseCreatorClipEventDraft,
  type PoseCreatorClipKeyframeDraft,
} from "./poseCreatorClipAuthoring";

import { buildEffectTracks } from "./poseCreatorEffectTracks";
import { accompanyingEventSound } from "./poseCreatorEventCatalog";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";
import {
  CreatorTimelineLane,
  CreatorTimelinePlayhead,
  CreatorTimelineRuler,
  CreatorTimelineToolbar,
  CreatorTimelineTransport,
} from "@/ui/content-creator/CreatorTimeline";
import {
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
  RULER_HEIGHT_PX,
  LANE_HEIGHT_PX,
  getTimelinePercent,
  getTimelineLeftStyle,
  formatTimelineTime,
} from "@/ui/content-creator/creatorTimelineGeometry";

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

const TRACK_MARKER_WIDTH_PX = TRACK_LABEL_RAIL_PX + TRACK_RIGHT_INSET_PX;
const EVENT_MARKER_SIZE_PX = 16;

type TimelineEventLane = Extract<
  PoseCreatorClipEventDraft["kind"],
  "avatar_vfx" | "scene_vfx" | "particle_vfx" | "sfx"
>;

export function PoseCreatorClipTimeline({
  variant = "panel",
  poseLaneLabel = "Pose",
  allowHumanoid = true,
  playbackPending = false,
  settingsContent,
  transportActions,
  expanded = true,
  onExpandedChange,
}: {
  variant?: "panel" | "workspace" | "mobile";
  poseLaneLabel?: string;
  allowHumanoid?: boolean;
  playbackPending?: boolean;
  settingsContent?: React.ReactNode;
  transportActions?: React.ReactNode;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { eventCatalog } = usePoseCreatorPreview();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const dropPreview = useCatalogTimelineDrop(
    {
      track: trackRef,
      viewport: viewportRef,
      section: sectionRef,
      expanded,
      onExpandedChange,
    },
    variant === "workspace",
  );
  const dragRef = useRef<TimelineDragState | null>(null);
  const updateClipDraft = usePoseCreatorStore((state) => state.updateClipDraft);
  const clipDraft = usePoseCreatorStore((state) => state.clipDraft);
  const [durationInput, setDurationInput] = useState(
    String(clipDraft.duration),
  );
  useEffect(
    () => setDurationInput(String(clipDraft.duration)),
    [clipDraft.duration],
  );
  const clipSnapEnabled = usePoseCreatorStore((state) => state.clipSnapEnabled);
  const clipSnapIntervalSec = usePoseCreatorStore(
    (state) => state.clipSnapIntervalSec,
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
  const effectTracks = useMemo(
    () => buildEffectTracks(clipDraft.events, duration, eventCatalog),
    [clipDraft.events, duration, eventCatalog],
  );
  const trackRows =
    1 + effectTracks.reduce((count, track) => count + track.rowCount, 0);
  const dropRow = dropPreview?.lane === "pose" ? 0 : trackRows;
  const visibleRows = Math.max(
    1,
    trackRows + (dropPreview && dropRow === trackRows ? 1 : 0),
  );
  const dropPercent = dropPreview
    ? getTimelinePercent(dropPreview.time, duration)
    : 0;
  const dropLabel = dropPreview
    ? `${dropPreview.replacesPose ? "Replace pose at " : ""}${formatTimelineTime(dropPreview.time)}`
    : "";
  const overlapsDropLabel = (time: number) => {
    if (!dropPreview) return false;
    const width = Math.max(
      1,
      (trackRef.current?.clientWidth ?? 0) - TRACK_MARKER_WIDTH_PX,
    );
    // Account for edge-aligned replacement text as well as short centered times.
    const labelWidth = dropLabel.length * 7;
    const dropX = (dropPercent / 100) * width;
    const labelLeft =
      dropX -
      (dropPercent > 80 ? labelWidth : dropPercent < 20 ? 0 : labelWidth / 2);
    const otherX = (getTimelinePercent(time, duration) / 100) * width;
    return otherX + 24 >= labelLeft && otherX - 24 <= labelLeft + labelWidth;
  };

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
    return timelinePointerTime(clientX, rect, duration);
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
    event.currentTarget.focus({ preventScroll: true });
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
    event.currentTarget.focus({ preventScroll: true });
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
  };

  return (
    <>
      <section
        ref={sectionRef}
        aria-label="Timeline"
        tabIndex={-1}
        onKeyDown={handleTimelineDeleteKey}
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
          <CreatorTimelineToolbar
            leading={
              <>
                <label className="flex items-center gap-2 text-xs font-medium">
                  Duration
                  <Input
                    type="number"
                    min={0}
                    step={0.05}
                    value={durationInput}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDurationInput(value);
                      const duration = Number(value);
                      if (Number.isFinite(duration) && duration >= 0.001)
                        updateClipDraft({ duration });
                    }}
                    onFocus={beginClipUndoGroup}
                    onBlur={() => {
                      setDurationInput(String(clipDraft.duration));
                      endClipUndoGroup();
                    }}
                    aria-label="Clip duration in seconds"
                    className="h-8 w-20"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-medium">
                  Loop
                  <Switch
                    checked={clipDraft.loop}
                    onCheckedChange={(loop) => updateClipDraft({ loop })}
                    aria-label="Toggle clip loop"
                  />
                </label>
              </>
            }
            transport={
              <>
                <CreatorTimelineTransport
                  playing={clipPlaybackPlaying}
                  onTogglePlayback={
                    clipPlaybackPlaying ? pauseClipPreview : playClipPreview
                  }
                  onStop={stopClipPreview}
                  onRestart={restartClipPreview}
                  playDisabled={!canPlayPreview}
                  stopDisabled={!hasPlayableContent}
                  restartDisabled={!canPlayPreview}
                  pending={playbackPending}
                />

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
                {transportActions}
              </>
            }
            trailing={
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Timeline settings"
                      title="Timeline settings"
                    >
                      <Settings2Icon className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="end"
                    className="max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-2rem))] space-y-3 overflow-y-auto"
                  >
                    <PoseCreatorClipWorkspaceInspector
                      section="settings"
                      allowHumanoid={allowHumanoid}
                    />
                    {settingsContent}
                    <p className="border-t pt-3 text-sm font-semibold">
                      Timeline settings
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs">Playback speed</span>
                      <Select
                        value={String(clipPlaybackSpeed)}
                        onValueChange={(value) =>
                          setClipPlaybackSpeed(Number(value))
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-16 shrink-0"
                          size="sm"
                          aria-label="Clip playback speed"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS.map(
                            (option) => (
                              <SelectItem
                                key={option.value}
                                value={String(option.value)}
                              >
                                {option.label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <label className="flex h-8 items-center justify-between gap-3">
                        <span className="text-muted-foreground text-xs font-medium">
                          Snap
                        </span>
                        <Switch
                          checked={clipSnapEnabled}
                          onCheckedChange={setClipSnapEnabled}
                          aria-label="Toggle timeline snap"
                        />
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs">Snap interval</span>
                        <Select
                          value={String(clipSnapIntervalSec)}
                          onValueChange={(value) =>
                            setClipSnapInterval(Number(value))
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-20 shrink-0"
                            size="sm"
                            aria-label="Timeline snap interval"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            {POSE_CREATOR_CLIP_SNAP_INTERVAL_OPTIONS.map(
                              (option) => (
                                <SelectItem
                                  key={option.value}
                                  value={String(option.value)}
                                >
                                  {option.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {variant === "workspace" && onExpandedChange ? (
                  <CreatorPanelCollapseButton
                    label="timeline"
                    expanded={expanded}
                    collapseDirection="down"
                    onExpandedChange={onExpandedChange}
                  />
                ) : null}
              </>
            }
          />

          {expanded ? (
            <div
              ref={viewportRef}
              className="h-[178px] w-full overflow-auto overscroll-contain rounded-md"
            >
              <div
                ref={trackRef}
                className={cn(
                  "border-border/70 bg-muted/20 relative min-h-[176px] cursor-crosshair rounded-md border",
                  variant === "mobile" && "min-w-[680px] touch-pan-x",
                )}
                style={{
                  height: RULER_HEIGHT_PX + visibleRows * LANE_HEIGHT_PX + 12,
                }}
                onPointerDown={handleTrackPointerDown}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerUp}
                onPointerCancel={handleTrackPointerUp}
              >
                <div className="bg-background sticky top-0 z-40 h-8">
                  <CreatorTimelineRuler
                    durationSec={duration}
                    hideTick={overlapsDropLabel}
                  />
                  <CreatorTimelinePlayhead
                    timeSec={clipDraft.currentTimeSec}
                    durationSec={duration}
                    hideLabel={overlapsDropLabel(clipDraft.currentTimeSec)}
                  />
                </div>
                <CreatorTimelineLane index={0} label={poseLaneLabel} />
                {effectTracks.flatMap((track) =>
                  Array.from({ length: track.rowCount }, (_, offset) => (
                    <CreatorTimelineLane
                      key={`${track.id}:${offset}`}
                      index={track.firstRow + offset}
                      label={
                        offset === 0
                          ? track.label
                          : `${track.label} (${offset + 1})`
                      }
                    />
                  )),
                )}

                {clipDraft.keyframes.map((keyframe) => (
                  <KeyframeMarker
                    key={keyframe.id}
                    duration={duration}
                    keyframe={keyframe}
                    selected={keyframe.id === clipDraft.selectedKeyframeId}
                    onFocus={() => selectClipKeyframe(keyframe.id)}
                    onPointerDown={handleKeyframePointerDown}
                    onPointerMove={handleKeyframePointerMove}
                    onPointerUp={handleKeyframePointerUp}
                    mobile={variant === "mobile"}
                  />
                ))}

                {effectTracks.flatMap((track) =>
                  track.entries.map((layout) => (
                    <EventMarker
                      key={layout.event.id}
                      duration={duration}
                      event={layout.event}
                      accompanyingSound={
                        accompanyingEventSound(layout.event, eventCatalog)
                          ?.label
                      }
                      row={layout.row}
                      end={layout.end}
                      label={track.label}
                      selected={layout.event.id === clipDraft.selectedEventId}
                      onFocus={() => selectClipEvent(layout.event.id)}
                      onPointerDown={handleEventPointerDown}
                      onPointerMove={handleEventPointerMove}
                      onPointerUp={handleEventPointerUp}
                      onKeyDown={handleEventKeyDown}
                      mobile={variant === "mobile"}
                    />
                  )),
                )}

                {dropPreview ? (
                  <div
                    aria-label="Timeline drop preview"
                    className="pointer-events-none absolute top-0 bottom-0 z-30"
                    style={{ left: getTimelineLeftStyle(dropPercent) }}
                  >
                    <span
                      aria-label="Drop time"
                      className={cn(
                        "text-foreground absolute top-1 text-[11px] font-semibold whitespace-nowrap tabular-nums",
                        dropPercent > 80
                          ? "right-0"
                          : dropPercent < 20
                            ? "left-0"
                            : "-translate-x-1/2",
                      )}
                    >
                      {dropLabel}
                    </span>
                    <span className="border-primary absolute top-8 bottom-3 border-l-2 border-dashed opacity-70" />
                    <span
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 border opacity-60 shadow-sm",
                        dropPreview.lane === "pose"
                          ? "bg-primary/25 border-primary size-4 rotate-45 rounded-[2px]"
                          : getEventMarkerClassName(dropPreview.lane),
                      )}
                      style={{
                        top:
                          RULER_HEIGHT_PX +
                          dropRow * LANE_HEIGHT_PX +
                          LANE_HEIGHT_PX / 2,
                      }}
                    />
                  </div>
                ) : null}

                <CreatorTimelinePlayhead
                  timeSec={clipDraft.currentTimeSec}
                  durationSec={duration}
                  hideLabel
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function KeyframeMarker({
  keyframe,
  duration,
  selected,
  onFocus,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  mobile,
}: {
  keyframe: PoseCreatorClipKeyframeDraft;
  duration: number;
  selected: boolean;
  onFocus: () => void;
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
          getKeyframeLaneCenterPx() - (mobile ? 20 : EVENT_MARKER_SIZE_PX) / 2,
        left: getTimelineLeftStyle(percent),
      }}
      aria-label={`${keyframe.pose} keyframe at ${formatTimelineTime(
        keyframe.time,
      )}`}
      title={`${keyframe.pose} / ${formatTimelineTime(keyframe.time)}`}
      onFocus={onFocus}
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
  accompanyingSound,
  duration,
  row,
  end,
  label,
  selected,
  onFocus,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  mobile,
}: {
  event: PoseCreatorClipEventDraft;
  accompanyingSound?: string;
  duration: number;
  row: number;
  end: number;
  label: string;
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
  const title = `${label} / ${formatEventMarkerTitle(event)}`;
  const hasDuration = isAnimaPoseClipVFXEvent(event);
  const untilAction = hasDuration && event.duration === undefined;
  const endPercent = getTimelinePercent(end, duration);

  return (
    <button
      type="button"
      className={cn(
        "focus-visible:ring-ring absolute z-10 -translate-x-1/2 border text-[0px] shadow-sm transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        selected ? "ring-ring ring-offset-background ring-2 ring-offset-2" : "",
        mobile && "min-h-5 min-w-5",
        hasDuration
          ? cn(
              "h-5 min-w-2 translate-x-0 overflow-hidden rounded border px-1 text-left text-[10px]",
              getEventBarClassName(event.kind),
              untilAction && "border-r-dashed border-r-2",
            )
          : getEventMarkerClassName(event.kind),
      )}
      style={{
        top:
          RULER_HEIGHT_PX +
          row * LANE_HEIGHT_PX +
          LANE_HEIGHT_PX / 2 -
          (hasDuration || mobile ? 20 : EVENT_MARKER_SIZE_PX) / 2,
        left: getTimelineLeftStyle(percent),
        width: hasDuration
          ? `calc((100% - ${TRACK_MARKER_WIDTH_PX}px) * ${Math.max(0, endPercent - percent) / 100})`
          : undefined,
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
      {hasDuration ? (
        <span className="block truncate">
          {label}
          {untilAction ? " →" : ""}
        </span>
      ) : (
        event.id
      )}
      {accompanyingSound ? (
        <span
          className={cn(
            "bg-background absolute rounded-full p-0.5",
            hasDuration ? "top-0.5 right-0.5" : "-top-2 -right-2",
          )}
          aria-label={`Accompanying sound: ${accompanyingSound}`}
        >
          {(event.kind === "avatar_vfx" || event.kind === "scene_vfx") &&
          event.playAccompanyingSound === false ? (
            <VolumeXIcon className="size-2.5" />
          ) : (
            <Volume2Icon className="size-2.5" />
          )}
        </span>
      ) : null}
    </button>
  );
}

function getKeyframeLaneCenterPx(): number {
  return RULER_HEIGHT_PX + LANE_HEIGHT_PX / 2;
}

function getEventBarClassName(kind: TimelineEventLane): string {
  if (kind === "avatar_vfx")
    return "border-emerald-500 bg-emerald-500/25 text-foreground";
  if (kind === "scene_vfx")
    return "border-amber-500 bg-amber-500/25 text-foreground";
  if (kind === "particle_vfx")
    return "border-violet-500 bg-violet-500/25 text-foreground";
  return "border-sky-500 bg-sky-500/25 text-foreground";
}

/** Share each effect marker's shape/color with its catalog drop preview. */
function getEventMarkerClassName(kind: TimelineEventLane): string {
  if (kind === "avatar_vfx") {
    return "size-4 rounded-full border-emerald-300 bg-emerald-500 hover:border-emerald-100 hover:bg-emerald-400";
  }
  if (kind === "scene_vfx") {
    return "size-4 rounded-[4px] border-amber-300 bg-amber-500 hover:border-amber-100 hover:bg-amber-400";
  }
  if (kind === "particle_vfx") {
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
  } else if (isAnimaPoseClipVFXEvent(event)) {
    parts.push("until Action ends");
  }
  return parts.join(" / ");
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
