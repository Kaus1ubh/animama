import { SlidersHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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
import { ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS } from "@/lib/avatar/poses/animaPoseClip/clipVocabulary";
import {
  findPoseCreatorClipKeyframeAtTime,
  isPoseCreatorBaseKeyframe,
  POSE_CREATOR_CLIP_EASINGS,
} from "./poseCreatorClipAuthoring";
import {
  basePoseLabel,
  beatLabel,
  easeLabel,
  mutableLayerLabel,
  particleAnchorLabel,
} from "./poseLabels";
import { accompanyingEventSound } from "./poseCreatorEventCatalog";
import {
  PoseCreatorAvatarEffectUseSection,
  useAvatarEffectUse,
  useAvatarEffectUseSource,
} from "./PoseCreatorAvatarEffectUse";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";
import { usePoseCreatorClipUndoGrouping } from "./usePoseCreatorUndoGrouping";
import type { BeatDetailSummary } from "@/lib/avatar/poses/animaPoseClip/beatEditing";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  type AnimaPoseClipEase,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";

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
  const { t } = useTranslation("pose");
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
                  {t("clip.inspector.title")}
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t("clip.inspector.empty")}
                </p>
              </div>
              <SlidersHorizontalIcon className="text-muted-foreground size-4" />
            </div>
          </WorkspaceCard>
        ))}

      {section !== "inspector" ? (
        <section>
          <h2 className="text-foreground text-sm font-semibold">
            {t("clip.settings.title")}
          </h2>
          <div className="mt-3 space-y-3">
            {allowHumanoid ? (
              <>
                <InspectorRow label={t("clip.settings.base")}>
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
                      aria-label={t("clip.settings.baseLabel")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BASE_VALUE}>
                        {t("clip.settings.none")}
                      </SelectItem>
                      {POSE_CREATOR_BASE_POSE_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {basePoseLabel(t, option)}
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
                    frame && isPoseCreatorBaseKeyframe(frame),
                  );
                  const occupied = Boolean(frame && !checked);
                  const label =
                    endpoint === "start"
                      ? t("clip.settings.startBase")
                      : t("clip.settings.endBase");
                  return (
                    <label
                      key={endpoint}
                      className="text-muted-foreground flex min-h-9 items-center justify-between gap-3 text-xs font-medium"
                      title={
                        occupied
                          ? t("clip.settings.endpointOccupied")
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

            <InspectorRow label={t("clip.settings.fadeIn")}>
              <DurationInput
                value={clipDraft.fadeIn?.duration ?? 0}
                label={t("clip.settings.fadeInLabel")}
                onChange={(duration) =>
                  updateClipDraft({
                    fadeIn: { ...clipDraft.fadeIn, duration },
                  })
                }
              />
            </InspectorRow>

            <InspectorRow label={t("clip.settings.fadeOut")}>
              <DurationInput
                value={clipDraft.fadeOut?.duration ?? 0}
                label={t("clip.settings.fadeOutLabel")}
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
                  title={t("clip.settings.muteHelp")}
                >
                  {t("clip.settings.mute")}
                </legend>
                {ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS.map((layerId) => {
                  const label = mutableLayerLabel(t, layerId);
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
                        aria-label={t("clip.settings.muteLayer", {
                          layer: label,
                        })}
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
  const { t } = useTranslation("pose");
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  const { eventCatalog } = usePoseCreatorPreview();
  const label = resolveEventLabel(event, eventCatalog);
  const accompanyingSound = accompanyingEventSound(event, eventCatalog);
  const effectUse = useAvatarEffectUse(
    event,
    useAvatarEffectUseSource(event),
    onUpdate,
  );
  // An effect that declares several sounds lets each use pick one.
  const effectSounds =
    effectUse && effectUse.source.sounds.length > 1
      ? effectUse.source.sounds
      : null;
  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading
        title={t("clip.event.title")}
        subtitle={label}
        onClose={onClose}
        closeLabel={t("clip.event.close")}
        onDelete={onDelete}
        deleteLabel={t("clip.event.delete")}
        disabled={disabled}
      />
      <div className="mt-4 space-y-3">
        <InspectorRow label={t("clip.event.start")}>
          <DurationInput
            value={event.time}
            label={t("clip.event.startLabel")}
            disabled={disabled}
            onChange={(time) => onUpdate({ time })}
          />
        </InspectorRow>

        {isAnimaPoseClipVFXEvent(event) ? (
          <>
            <InspectorRow label={t("clip.event.end")}>
              <Select
                value={event.duration === undefined ? "action" : "duration"}
                disabled={disabled}
                onValueChange={(value) =>
                  onUpdate({ duration: value === "action" ? null : 1 })
                }
              >
                <SelectTrigger
                  className="h-9 w-[176px]"
                  aria-label={t("clip.event.endLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="action">
                    {t("clip.event.withAction")}
                  </SelectItem>
                  <SelectItem value="duration">
                    {t("clip.event.afterDuration")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </InspectorRow>
            {/* Its own row, so the End choice is never truncated. */}
            {event.duration !== undefined ? (
              <InspectorRow label={t("clip.event.duration")}>
                <DurationInput
                  value={event.duration}
                  label={t("clip.event.durationLabel")}
                  disabled={disabled}
                  min={0.001}
                  onChange={(duration) => onUpdate({ duration })}
                />
              </InspectorRow>
            ) : null}
          </>
        ) : null}

        {event.kind === "avatar_vfx" && event.duration !== undefined ? (
          <>
            <InspectorRow label={t("clip.settings.fadeIn")}>
              <DurationInput
                value={event.envelope?.intensity?.fadeIn ?? 0}
                label={t("clip.event.fadeInLabel")}
                disabled={disabled}
                onChange={(fadeIn) => onUpdate({ fadeIn })}
              />
            </InspectorRow>
            <InspectorRow label={t("clip.settings.fadeOut")}>
              <DurationInput
                value={event.envelope?.intensity?.fadeOut ?? 0}
                label={t("clip.event.fadeOutLabel")}
                disabled={disabled}
                onChange={(fadeOut) => onUpdate({ fadeOut })}
              />
            </InspectorRow>
          </>
        ) : null}

        {(accompanyingSound || effectSounds) &&
        (event.kind === "avatar_vfx" || event.kind === "scene_vfx") ? (
          <>
            <InspectorRow label={t("clip.event.accompanyingSound")}>
              {effectUse && effectSounds ? (
                <Select
                  value={effectUse.soundAlias ?? ""}
                  disabled={disabled}
                  onValueChange={effectUse.chooseSound}
                >
                  <SelectTrigger
                    className="h-9 w-[176px]"
                    aria-label={t("clip.event.accompanyingSoundLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {effectSounds.map((sound) => (
                      <SelectItem key={sound.alias} value={sound.alias}>
                        {sound.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <ReadOnlyField>{accompanyingSound?.label}</ReadOnlyField>
              )}
            </InspectorRow>
            <InspectorRow label={t("clip.event.playAccompanyingSound")}>
              <Switch
                aria-label={t("clip.event.playAccompanyingSound")}
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
            <InspectorRow label={t("clip.event.anchor")}>
              <Select
                value={event.anchor ?? "root"}
                disabled={disabled}
                onValueChange={(anchor) =>
                  onUpdate({ anchor: anchor as ParticleVFXAnchor })
                }
              >
                <SelectTrigger
                  className="h-9 w-[176px]"
                  aria-label={t("clip.event.anchorLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTICLE_VFX_ANCHORS.map((anchor) => (
                    <SelectItem key={anchor} value={anchor}>
                      {particleAnchorLabel(t, anchor)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InspectorRow>
            <InspectorRow label={t("clip.event.followAnchor")}>
              <Switch
                checked={event.followAnchor !== false}
                disabled={disabled}
                onCheckedChange={(followAnchor) => onUpdate({ followAnchor })}
                aria-label={t("clip.event.followAnchorLabel")}
              />
            </InspectorRow>
          </>
        ) : null}

        {event.kind === "sfx" ? (
          <>
            <InspectorRow label={t("clip.event.volume")}>
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
                aria-label={t("clip.event.volumeLabel")}
              />
            </InspectorRow>
          </>
        ) : null}

        {effectUse ? (
          <PoseCreatorAvatarEffectUseSection
            use={effectUse}
            disabled={disabled}
          />
        ) : null}
      </div>
    </WorkspaceCard>
  );
}

export function KeyframeInspector({
  embedded,
  keyframe,
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
  allowHumanoid: boolean;
  disabled: boolean;
  onClose: () => void;
  onUpdate: ReturnType<
    typeof usePoseCreatorStore.getState
  >["updateSelectedClipKeyframe"];
  onDelete: () => void;
}) {
  const { t } = useTranslation("pose");
  return (
    <WorkspaceCard embedded={embedded}>
      <InspectorHeading
        title={
          allowHumanoid
            ? t("clip.keyframe.title")
            : t("clip.keyframe.expressionTitle")
        }
        subtitle={beatLabel(t, keyframe.label)}
        onClose={embedded ? undefined : onClose}
        closeLabel={
          allowHumanoid
            ? t("clip.keyframe.close")
            : t("clip.keyframe.closeExpression")
        }
        onDelete={onDelete}
        deleteLabel={t("clip.keyframe.delete")}
        disabled={disabled}
      />
      <div className="mt-4 space-y-3">
        <InspectorRow label={t("clip.keyframe.time")}>
          <DurationInput
            value={keyframe.time}
            label={t("clip.keyframe.timeLabel")}
            disabled={disabled}
            onChange={(time) => onUpdate({ time })}
          />
        </InspectorRow>
        <InspectorRow label={t("clip.keyframe.label")}>
          <BeatLabelInput
            key={keyframe.id}
            value={keyframe.label}
            disabled={disabled}
            onCommit={(label) => onUpdate({ label })}
          />
        </InspectorRow>
        <InspectorRow label={t("clip.keyframe.easing")}>
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
              aria-label={t("clip.keyframe.easingLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>
                {t("clip.keyframe.clipDefault")}
              </SelectItem>
              {BEAT_EASES.map((ease) => (
                <SelectItem key={ease} value={ease}>
                  {easeLabel(t, ease)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorRow>
        {keyframe.detail ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {formatBeatDetail(t, keyframe.detail)}
          </p>
        ) : null}
      </div>
    </WorkspaceCard>
  );
}

/** Beat arrival eases: the smooth and hold choices, then the curve easings. */
const BEAT_EASES: readonly AnimaPoseClipEase[] = [
  "smooth",
  "hold",
  ...POSE_CREATOR_CLIP_EASINGS,
];

/** The read-only note for a beat's generated detail. */
export function formatBeatDetail(
  t: TFunction<"pose">,
  detail: BeatDetailSummary,
): string {
  return t("clip.keyframe.detail", {
    count: detail.channels,
    before: formatSeconds(t, detail.before),
    after: formatSeconds(t, detail.after),
  });
}

function formatSeconds(t: TFunction<"pose">, value: number): string {
  return t("units.seconds", { value: Number(value.toFixed(2)) });
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
  const { t } = useTranslation("pose");
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() && text.trim() !== value) onCommit(text);
    else setText(value);
  };
  return (
    <Input
      className="h-9 w-[176px]"
      aria-label={t("clip.keyframe.labelInput")}
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
  closeLabel,
  onDelete,
  deleteLabel,
  disabled,
}: {
  title: string;
  subtitle: string;
  onClose?: () => void;
  closeLabel: string;
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
            aria-label={closeLabel}
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
  onChange,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  min?: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation("pose");
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
        {t("units.secondsSuffix")}
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
