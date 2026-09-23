"use client";

import {
  CopyIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  isAnimaPoseClipVFXEvent,
  PARTICLE_VFX_ANCHORS,
  type AnimaPoseClipEvent,
  type AnimaPoseClipSceneVFXKind,
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
  findPoseCreatorClipKeyframeAtTime,
  isPoseCreatorBaseKeyframe,
  POSE_CREATOR_CLIP_EASING_OPTIONS,
} from "./poseCreatorClipAuthoring";
import { withUnavailableEventOption } from "./poseCreatorEventCatalog";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";
import { usePoseCreatorClipUndoGrouping } from "./usePoseCreatorUndoGrouping";

const INHERIT_VALUE = "__inherit__";
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
  const duplicateSelectedClipKeyframe = usePoseCreatorStore(
    (state) => state.duplicateSelectedClipKeyframe,
  );
  const duplicateSelectedClipEvent = usePoseCreatorStore(
    (state) => state.duplicateSelectedClipEvent,
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
            onDuplicate={duplicateSelectedClipEvent}
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
            onDuplicate={duplicateSelectedClipKeyframe}
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
  onDuplicate,
  onDelete,
}: {
  embedded: boolean;
  event: AnimaPoseClipEvent;
  disabled: boolean;
  onClose: () => void;
  onUpdate: ReturnType<
    typeof usePoseCreatorStore.getState
  >["updateSelectedClipEvent"];
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  const { eventCatalog } = usePoseCreatorPreview();
  const label = resolveEventLabel(event, eventCatalog);
  const sceneOptions =
    event.kind === "scene_vfx" && event.sceneKind === "background_layers"
      ? eventCatalog.sceneBackground
      : eventCatalog.sceneFocus;

  const changeParticleEffect = (effectId: string) => {
    const option = eventCatalog.particleVFX.find(
      (item) => item.id === effectId,
    );
    onUpdate({
      effectId,
      ...(option
        ? {
            anchor: option.defaultAnchor,
            duration: option.defaultDurationSec,
            transform: option.defaultTransform,
          }
        : {}),
    });
  };

  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading title="Event" subtitle={label} onClose={onClose} />
      <div className="mt-4 space-y-3">
        <InspectorRow label="Time">
          <DurationInput
            value={event.time}
            label="Selected event time"
            disabled={disabled}
            onChange={(time) => onUpdate({ time })}
          />
        </InspectorRow>

        <InspectorRow label="Type">
          <ReadOnlyField>{formatEventKind(event)}</ReadOnlyField>
        </InspectorRow>

        {event.kind === "avatar_vfx" ? (
          <InspectorRow label="Resource">
            <ResourceSelect
              value={event.effectId}
              label="Avatar Effect"
              options={withUnavailableEventOption(
                eventCatalog.avatarVFX,
                event.effectId,
              )}
              disabled={disabled}
              onValueChange={(effectId) => onUpdate({ effectId })}
            />
          </InspectorRow>
        ) : null}

        {event.kind === "scene_vfx" ? (
          <>
            <InspectorRow label="Type">
              <Select
                value={event.sceneKind}
                disabled={disabled}
                onValueChange={(value) => {
                  const sceneKind = value as AnimaPoseClipSceneVFXKind;
                  const options =
                    sceneKind === "background_layers"
                      ? eventCatalog.sceneBackground
                      : eventCatalog.sceneFocus;
                  onUpdate({
                    sceneKind,
                    presetId: options[0]?.id ?? event.presetId,
                  });
                }}
              >
                <SelectTrigger
                  className="h-9 w-[176px]"
                  aria-label="Scene effect type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="background_layers">Background</SelectItem>
                  <SelectItem value="focus_lines">Focus lines</SelectItem>
                </SelectContent>
              </Select>
            </InspectorRow>
            <InspectorRow label="Resource">
              <ResourceSelect
                value={event.presetId}
                label="Scene Effect"
                options={withUnavailableEventOption(
                  sceneOptions,
                  event.presetId,
                )}
                disabled={disabled}
                onValueChange={(presetId) => onUpdate({ presetId })}
              />
            </InspectorRow>
          </>
        ) : null}

        {event.kind === "particle_vfx" ? (
          <>
            <InspectorRow label="Resource">
              <ResourceSelect
                value={event.effectId}
                label="Particle Effect"
                options={withUnavailableEventOption(
                  eventCatalog.particleVFX,
                  event.effectId,
                )}
                disabled={disabled}
                onValueChange={changeParticleEffect}
              />
            </InspectorRow>
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
            <InspectorRow label="Resource">
              <ResourceSelect
                value={event.cueId}
                label="Sound Effect"
                options={withUnavailableEventOption(
                  eventCatalog.sfx,
                  event.cueId,
                )}
                disabled={disabled}
                onValueChange={(cueId) => onUpdate({ cueId })}
              />
            </InspectorRow>
            <InspectorRow label="Volume">
              <Input
                type="number"
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

        {isAnimaPoseClipVFXEvent(event) ? (
          <InspectorRow label="Duration">
            <DurationInput
              value={event.duration ?? 0}
              label="Selected event duration"
              disabled={disabled}
              min={0.001}
              onChange={(duration) => onUpdate({ duration })}
            />
          </InspectorRow>
        ) : null}
      </div>

      <div className="border-border/70 mt-4 flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <CopyIcon className="size-3.5" />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={onDelete}
            aria-label="Delete selected event"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
    </WorkspaceCard>
  );
}

function KeyframeInspector({
  embedded,
  keyframe,
  poseAliases,
  allowHumanoid,
  disabled,
  onClose,
  onUpdate,
  onDuplicate,
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
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading
        title={allowHumanoid ? "Keyframe" : "Expression keyframe"}
        subtitle={formatSourceLabel(keyframe.pose)}
        onClose={embedded ? undefined : onClose}
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
        {allowHumanoid ? (
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
        </InspectorRow>
      </div>
      <div className="border-border/70 mt-4 flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <CopyIcon className="size-3.5" />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={onDelete}
            aria-label="Delete selected keyframe"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
    </WorkspaceCard>
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
}: {
  title: string;
  subtitle: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {subtitle}
        </p>
      </div>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-1"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} inspector`}
        >
          <XIcon className="size-4" />
        </Button>
      ) : null}
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
  onChange,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  min?: number;
  onChange: (value: number) => void;
}) {
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  return (
    <div className="relative w-[176px]">
      <Input
        type="number"
        min={min}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onFocus={beginUndoGroup}
        onBlur={endUndoGroup}
        className="h-9 pr-8"
        aria-label={label}
      />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
        s
      </span>
    </div>
  );
}

function ResourceSelect({
  value,
  label,
  options,
  disabled,
  onValueChange,
}: {
  value: string;
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger className="h-9 w-[176px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

function formatEventKind(event: AnimaPoseClipEvent): string {
  if (event.kind === "avatar_vfx") return "Avatar VFX";
  if (event.kind === "scene_vfx") return "Scene VFX";
  if (event.kind === "particle_vfx") return "Particle VFX";
  return "SFX";
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
