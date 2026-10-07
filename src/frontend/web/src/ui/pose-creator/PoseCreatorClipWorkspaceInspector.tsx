"use client";

import { SlidersHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  isAnimaPoseClipVFXEvent,
  PARTICLE_VFX_ANCHORS,
  type AnimaPoseClipEvent,
  type ParticleVFXAnchor,
} from "@/lib/avatar";
import {
  POSE_CREATOR_BASE_POSE_OPTIONS,
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
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
import {
  ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS,
  type AnimaPoseClipMutableLayerId,
} from "@/lib/avatar/poses/animaPoseClip/schema";
import {
  findPoseCreatorClipKeyframeAtTime,
  isPoseCreatorBaseKeyframe,
  POSE_CREATOR_CLIP_EASING_OPTIONS,
} from "./poseCreatorClipAuthoring";
import { accompanyingEventSound } from "./poseCreatorEventCatalog";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";
import { usePoseCreatorClipUndoGrouping } from "./usePoseCreatorUndoGrouping";
import type { BeatDetailSummary } from "@/lib/avatar/poses/animaPoseClip/beatEditing";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  type AnimaPoseClipEase,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";

const INHERIT_VALUE = "__inherit__";
/** Names for the live procedural layers a Gesture can mute. */
const MUTABLE_LAYER_LABELS: Record<AnimaPoseClipMutableLayerId, string> = {
  breathing: "Breathing",
  sway: "Sway",
  bounce: "Bounce",
  headNod: "Head nod",
  headSideTilt: "Head tilt",
  cursorLookAt: "Cursor look-at",
  emotionPosture: "Emotion posture",
};
const NO_BASE_VALUE = "__no_base__";

/** Focus the selected timeline item and common Clip settings in desktop or mobile workspaces. */
export function PoseCreatorClipWorkspaceInspector({
  variant = "workspace",
  section = "all",
  allowHumanoid = true,
  embedded = false,
}: {
  variant?: "workspace" | "mobile";
  section?: "all" | "inspector" | "settings";
  /** Hide body-pose controls when this inspector is hosted by a Reaction. */
  allowHumanoid?: boolean;
  /** Plain sections for selected-item controls hosted in timeline settings. */
  embedded?: boolean;
}) {
  const clipDraft = usePoseCreatorStore((state) => state.clipDraft);
  const clipInlineEdit = usePoseCreatorStore((state) => state.clipInlineEdit);
  const updateClipDraft = usePoseCreatorStore((state) => state.updateClipDraft);
  const setClipBaseEndpoint = usePoseCreatorStore(
    (state) => state.setClipBaseEndpoint,
  );
  const selectClipKeyframe = usePoseCreatorStore(
    (state) => state.selectClipKeyframe,
  );
  const selectClipEvent = usePoseCreatorStore((state) => state.selectClipEvent);
  const updateSelectedClipKeyframe = usePoseCreatorStore(
    (state) => state.updateSelectedClipKeyframe,
  );
  const updateSelectedClipEvent = usePoseCreatorStore(
    (state) => state.updateSelectedClipEvent,
  );
  const deleteSelectedClipKeyframe = usePoseCreatorStore(
    (state) => state.deleteSelectedClipKeyframe,
  );
  const deleteSelectedClipEvent = usePoseCreatorStore(
    (state) => state.deleteSelectedClipEvent,
  );
  const selectedKeyframe =
    clipDraft.keyframes.find(
      (keyframe) => keyframe.id === clipDraft.selectedKeyframeId,
    ) ?? null;
  const selectedEvent =
    clipDraft.events.find((event) => event.id === clipDraft.selectedEventId) ??
    null;
  if (section === "inspector" && !selectedEvent && !selectedKeyframe)
    return null;

  return (
    <div
      className={
        variant === "mobile"
          ? "bg-background flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4"
          : embedded || section === "settings"
            ? "w-full"
            : "relative flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto pr-1"
      }
    >
      {section !== "settings" &&
        (selectedEvent ? (
          <EventInspector
            embedded={embedded}
            event={selectedEvent}
            disabled={Boolean(clipInlineEdit)}
            onClose={() => selectClipEvent(null)}
            onUpdate={updateSelectedClipEvent}
            onDelete={deleteSelectedClipEvent}
          />
        ) : selectedKeyframe ? (
          <KeyframeInspector
            embedded={embedded}
            keyframe={selectedKeyframe}
            poseAliases={Object.keys(clipDraft.poses)}
            allowHumanoid={allowHumanoid}
            disabled={Boolean(clipInlineEdit)}
            onClose={() => selectClipKeyframe(null)}
            onUpdate={updateSelectedClipKeyframe}
            onDelete={deleteSelectedClipKeyframe}
          />
        ) : (
          <WorkspaceCard>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-foreground text-sm font-semibold">
                  Inspector
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  Select a keyframe or event in the timeline to edit it.
                </p>
              </div>
              <SlidersHorizontalIcon className="text-muted-foreground size-4" />
            </div>
          </WorkspaceCard>
        ))}

      {section !== "inspector" ? (
        <section>
          <h2 className="text-foreground text-sm font-semibold">
            Clip settings
          </h2>
          <div className="mt-3 space-y-3">
            {allowHumanoid ? (
              <>
                <InspectorRow label="Base">
                  <Select
                    value={clipDraft.basePose || NO_BASE_VALUE}
                    onValueChange={(basePose) =>
                      updateClipDraft({
                        basePose: basePose === NO_BASE_VALUE ? "" : basePose,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-[176px]"
                      aria-label="Clip base pose"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BASE_VALUE}>None</SelectItem>
                      {POSE_CREATOR_BASE_POSE_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </InspectorRow>
              </>
            ) : null}

            {allowHumanoid
              ? (["start", "end"] as const).map((endpoint) => {
                  const frame = findPoseCreatorClipKeyframeAtTime(
                    clipDraft.keyframes,
                    endpoint === "start" ? 0 : clipDraft.duration,
                  );
                  const checked = Boolean(
                    frame && isPoseCreatorBaseKeyframe(clipDraft, frame),
                  );
                  const occupied = Boolean(frame && !checked);
                  const label =
                    endpoint === "start" ? "Start base" : "End base";
                  return (
                    <label
                      key={endpoint}
                      className="text-muted-foreground flex min-h-9 items-center justify-between gap-3 text-xs font-medium"
                      title={
                        occupied
                          ? "Move or remove the existing endpoint pose to add a base keyframe."
                          : undefined
                      }
                    >
                      {label}
                      <Switch
                        checked={checked}
                        disabled={
                          occupied ||
                          !clipDraft.basePose ||
                          clipDraft.duration <= 0 ||
                          Boolean(clipInlineEdit) ||
                          clipDraft.basePose ===
                            POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID
                        }
                        onCheckedChange={(enabled) =>
                          setClipBaseEndpoint(endpoint, enabled)
                        }
                        aria-label={label}
                      />
                    </label>
                  );
                })
              : null}

            <InspectorRow label="Fade in">
              <DurationInput
                value={clipDraft.fadeIn?.duration ?? 0}
                label="Clip fade in duration"
                onChange={(duration) =>
                  updateClipDraft({
                    fadeIn: { ...clipDraft.fadeIn, duration },
                  })
                }
              />
            </InspectorRow>

            <InspectorRow label="Fade out">
              <DurationInput
                value={clipDraft.fadeOut?.duration ?? 0}
                label="Clip fade out duration"
                onChange={(duration) =>
                  updateClipDraft({
                    fadeOut: { ...clipDraft.fadeOut, duration },
                  })
                }
              />
            </InspectorRow>

            {allowHumanoid ? (
              <fieldset className="space-y-1 pt-1">
                <legend
                  className="text-foreground text-xs font-semibold"
                  title="Live idle motion that chat adds on top of a Gesture. The editor preview never shows it."
                >
                  Mute while playing
                </legend>
                {ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS.map((layerId) => {
                  const label = MUTABLE_LAYER_LABELS[layerId];
                  return (
                    <label
                      key={layerId}
                      className="text-muted-foreground flex min-h-8 items-center justify-between gap-3 text-xs font-medium"
                    >
                      {label}
                      <Switch
                        checked={clipDraft.mutedProceduralLayers.includes(
                          layerId,
                        )}
                        onCheckedChange={(muted) =>
                          updateClipDraft({
                            // Keep the canonical layer order for stable files.
                            mutedProceduralLayers:
                              ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS.filter((id) =>
                                id === layerId
                                  ? muted
                                  : clipDraft.mutedProceduralLayers.includes(
                                      id,
                                    ),
                              ),
                          })
                        }
                        aria-label={`Mute ${label.toLowerCase()} while playing`}
                      />
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EventInspector({
  embedded,
  event,
  disabled,
  onClose,
  onUpdate,
  onDelete,
}: {
  embedded: boolean;
  event: AnimaPoseClipEvent;
  disabled: boolean;
  onClose: () => void;
  onUpdate: ReturnType<
    typeof usePoseCreatorStore.getState
  >["updateSelectedClipEvent"];
  onDelete: () => void;
}) {
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  const { eventCatalog } = usePoseCreatorPreview();
  const label = resolveEventLabel(event, eventCatalog);
  const accompanyingSound = accompanyingEventSound(event, eventCatalog);
  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading
        title="Event"
        subtitle={label}
        onClose={onClose}
        onDelete={onDelete}
        deleteLabel="Delete selected event"
        disabled={disabled}
      />
      <div className="mt-4 space-y-3">
        <InspectorRow label="Start">
          <DurationInput
            value={event.time}
            label="Selected event start"
            disabled={disabled}
            onChange={(time) => onUpdate({ time })}
          />
        </InspectorRow>

        {isAnimaPoseClipVFXEvent(event) ? (
          <InspectorRow label="End">
            <div className="flex w-[176px] min-w-0 items-center gap-2">
              <Select
                value={event.duration === undefined ? "action" : "duration"}
                disabled={disabled}
                onValueChange={(value) =>
                  onUpdate({ duration: value === "action" ? null : 1 })
                }
              >
                <SelectTrigger
                  className="h-9 min-w-0 flex-1 gap-1 px-2"
                  aria-label="Selected event end"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="action">With Action</SelectItem>
                  <SelectItem value="duration">After</SelectItem>
                </SelectContent>
              </Select>
              {event.duration !== undefined ? (
                <DurationInput
                  value={event.duration}
                  label="Selected event duration"
                  disabled={disabled}
                  min={0.001}
                  compact
                  onChange={(duration) => onUpdate({ duration })}
                />
              ) : null}
            </div>
          </InspectorRow>
        ) : null}

        {event.kind === "avatar_vfx" && event.duration !== undefined ? (
          <>
            <InspectorRow label="Fade in">
              <DurationInput
                value={event.envelope?.intensity?.fadeIn ?? 0}
                label="Selected event fade in"
                disabled={disabled}
                onChange={(fadeIn) => onUpdate({ fadeIn })}
              />
            </InspectorRow>
            <InspectorRow label="Fade out">
              <DurationInput
                value={event.envelope?.intensity?.fadeOut ?? 0}
                label="Selected event fade out"
                disabled={disabled}
                onChange={(fadeOut) => onUpdate({ fadeOut })}
              />
            </InspectorRow>
          </>
        ) : null}

        {accompanyingSound &&
        (event.kind === "avatar_vfx" || event.kind === "scene_vfx") ? (
          <>
            <InspectorRow label="Accompanying sound">
              <ReadOnlyField>{accompanyingSound.label}</ReadOnlyField>
            </InspectorRow>
            <InspectorRow label="Play accompanying sound">
              <Switch
                aria-label="Play accompanying sound"
                checked={event.playAccompanyingSound !== false}
                disabled={disabled}
                onCheckedChange={(playAccompanyingSound) =>
                  onUpdate({ playAccompanyingSound })
                }
              />
            </InspectorRow>
          </>
        ) : null}
        {event.kind === "particle_vfx" ? (
          <>
            <InspectorRow label="Anchor">
              <Select
                value={event.anchor ?? "root"}
                disabled={disabled}
                onValueChange={(anchor) =>
                  onUpdate({ anchor: anchor as ParticleVFXAnchor })
                }
              >
                <SelectTrigger
                  className="h-9 w-[176px]"
                  aria-label="Particle VFX anchor"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTICLE_VFX_ANCHORS.map((anchor) => (
                    <SelectItem key={anchor} value={anchor}>
                      {formatIdentifier(anchor)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InspectorRow>
            <InspectorRow label="Follow anchor">
              <Switch
                checked={event.followAnchor !== false}
                disabled={disabled}
                onCheckedChange={(followAnchor) => onUpdate({ followAnchor })}
                aria-label="Follow particle VFX anchor"
              />
            </InspectorRow>
          </>
        ) : null}

        {event.kind === "sfx" ? (
          <>
            <InspectorRow label="Volume">
              <Input
                type="number"
                allowEmptyNumber
                min={0}
                max={1}
                step={0.05}
                value={event.volume ?? ""}
                disabled={disabled}
                onChange={(inputEvent) =>
                  onUpdate({
                    volume:
                      inputEvent.currentTarget.value === ""
                        ? null
                        : Number(inputEvent.currentTarget.value),
                  })
                }
                onFocus={beginUndoGroup}
                onBlur={endUndoGroup}
                className="h-9 w-[176px]"
                aria-label="SFX event volume"
              />
            </InspectorRow>
          </>
        ) : null}
      </div>
    </WorkspaceCard>
  );
}

export function KeyframeInspector({
  embedded,
  keyframe,
  poseAliases,
  allowHumanoid,
  disabled,
  onClose,
  onUpdate,
  onDelete,
}: {
  embedded: boolean;
  keyframe: ReturnType<
    typeof usePoseCreatorStore.getState
  >["clipDraft"]["keyframes"][number];
  poseAliases: string[];
  allowHumanoid: boolean;
  disabled: boolean;
  onClose: () => void;
  onUpdate: ReturnType<
    typeof usePoseCreatorStore.getState
  >["updateSelectedClipKeyframe"];
  onDelete: () => void;
}) {
  // A 2.0 draft's keyframes are beats: they carry a label and an arrival ease.
  const beat = keyframe.label !== undefined;
  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading
        title={allowHumanoid ? "Keyframe" : "Expression keyframe"}
        subtitle={keyframe.label ?? formatSourceLabel(keyframe.pose)}
        onClose={embedded ? undefined : onClose}
        onDelete={onDelete}
        deleteLabel="Delete selected keyframe"
        disabled={disabled}
      />
      <div className="mt-4 space-y-3">
        <InspectorRow label="Time">
          <DurationInput
            value={keyframe.time}
            label="Selected keyframe time"
            disabled={disabled}
            onChange={(time) => onUpdate({ time })}
          />
        </InspectorRow>
        {beat ? (
          <InspectorRow label="Label">
            <BeatLabelInput
              key={keyframe.id}
              value={keyframe.label ?? ""}
              disabled={disabled}
              onCommit={(label) => onUpdate({ label })}
            />
          </InspectorRow>
        ) : allowHumanoid ? (
          <InspectorRow label="Pose">
            <Select
              value={keyframe.pose}
              disabled={disabled}
              onValueChange={(pose) => onUpdate({ pose })}
            >
              <SelectTrigger
                className="h-9 w-[176px]"
                aria-label="Keyframe pose"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {poseAliases.map((alias) => (
                  <SelectItem key={alias} value={alias}>
                    {formatSourceLabel(alias)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InspectorRow>
        ) : null}
        <InspectorRow label="Easing">
          {beat ? (
            <Select
              value={keyframe.ease ?? INHERIT_VALUE}
              disabled={disabled}
              onValueChange={(ease) =>
                onUpdate({
                  ease:
                    ease === INHERIT_VALUE ? null : (ease as AnimaPoseClipEase),
                })
              }
            >
              <SelectTrigger
                className="h-9 w-[176px]"
                aria-label="Keyframe easing"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT_VALUE}>Clip default</SelectItem>
                {BEAT_EASE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={keyframe.transition?.easing ?? INHERIT_VALUE}
              disabled={disabled}
              onValueChange={(easing) =>
                onUpdate({
                  transition:
                    easing === INHERIT_VALUE
                      ? null
                      : {
                          ...(keyframe.transition ?? {}),
                          easing:
                            easing as (typeof POSE_CREATOR_CLIP_EASING_OPTIONS)[number]["value"],
                        },
                })
              }
            >
              <SelectTrigger
                className="h-9 w-[176px]"
                aria-label="Keyframe easing"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT_VALUE}>Clip default</SelectItem>
                {POSE_CREATOR_CLIP_EASING_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </InspectorRow>
        {keyframe.detail ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {formatBeatDetail(keyframe.detail)}
          </p>
        ) : null}
      </div>
    </WorkspaceCard>
  );
}

/** 2.0 arrival eases: the smooth and hold choices, then the 1.0 easings. */
const BEAT_EASE_OPTIONS: readonly {
  value: AnimaPoseClipEase;
  label: string;
}[] = [
  { value: "smooth", label: "Smooth" },
  { value: "hold", label: "Hold" },
  ...POSE_CREATOR_CLIP_EASING_OPTIONS,
];

/** The read-only note for a beat's generated detail. */
export function formatBeatDetail(detail: BeatDetailSummary): string {
  const channels =
    detail.channels === 1
      ? "1 joint or channel"
      : `${detail.channels} joints or channels`;
  return `Generated detail: moves ${channels} from ${formatSeconds(
    detail.before,
  )} before to ${formatSeconds(
    detail.after,
  )} after this keyframe. It follows the keyframe when you move it or edit its pose.`;
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(2))} s`;
}

/** The beat label, committed on blur or Enter (an empty label is ignored). */
function BeatLabelInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (label: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() && text.trim() !== value) onCommit(text);
    else setText(value);
  };
  return (
    <Input
      className="h-9 w-[176px]"
      aria-label="Keyframe label"
      value={text}
      maxLength={ANIMA_POSE_CLIP_V2_LIMITS.labelLength}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setText(value);
      }}
    />
  );
}

function WorkspaceCard({
  children,
  embedded = false,
}: {
  children: React.ReactNode;
  embedded?: boolean;
}) {
  return (
    <section
      className={
        embedded
          ? "border-t pt-3"
          : "border-border/70 bg-background rounded-xl border p-4 shadow-lg backdrop-blur-xl"
      }
    >
      {children}
    </section>
  );
}

function InspectorHeading({
  title,
  subtitle,
  onClose,
  onDelete,
  deleteLabel,
  disabled,
}: {
  title: string;
  subtitle: string;
  onClose?: () => void;
  onDelete: () => void;
  deleteLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {subtitle}
        </p>
      </div>
      <div className="-mt-1 -mr-1 flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          disabled={disabled}
          onClick={onDelete}
          aria-label={deleteLabel}
        >
          <Trash2Icon className="size-4" />
        </Button>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()} inspector`}
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function InspectorRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}

function DurationInput({
  value,
  label,
  disabled = false,
  min = 0,
  compact = false,
  onChange,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  min?: number;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  return (
    <div className={compact ? "relative w-20 shrink-0" : "relative w-[176px]"}>
      <Input
        type="number"
        min={min}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onFocus={beginUndoGroup}
        onBlur={endUndoGroup}
        className={
          compact
            ? "h-9 [appearance:textfield] pr-5 pl-2 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            : "h-9 pr-8"
        }
        aria-label={label}
      />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
        s
      </span>
    </div>
  );
}

function ReadOnlyField({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border/70 bg-muted/20 flex h-9 w-[176px] items-center rounded-md border px-3 text-xs">
      {children}
    </div>
  );
}

function resolveEventLabel(
  event: AnimaPoseClipEvent,
  catalog: ReturnType<typeof usePoseCreatorPreview>["eventCatalog"],
): string {
  if (event.kind === "avatar_vfx") {
    return (
      catalog.avatarVFX.find((option) => option.id === event.effectId)?.label ??
      event.effectId
    );
  }
  if (event.kind === "scene_vfx") {
    const options =
      event.sceneKind === "background_layers"
        ? catalog.sceneBackground
        : catalog.sceneFocus;
    return (
      options.find((option) => option.id === event.presetId)?.label ??
      event.presetId
    );
  }
  if (event.kind === "particle_vfx") {
    return (
      catalog.particleVFX.find((option) => option.id === event.effectId)
        ?.label ?? event.effectId
    );
  }
  return (
    catalog.sfx.find((option) => option.id === event.cueId)?.label ??
    event.cueId
  );
}

function formatIdentifier(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSourceLabel(value: string): string {
  return formatIdentifier(value);
}
