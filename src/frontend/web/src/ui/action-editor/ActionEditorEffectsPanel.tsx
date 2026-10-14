"use client";

import { useProductApiClient } from "@animama/product-ui";

import {
  Layers3Icon,
  PersonStandingIcon,
  PlusIcon,
  PlayIcon,
  SquareIcon,
  SearchIcon,
  SparklesIcon,
  UserRoundIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react";
import { TimelineIcon } from "@/ui/components/TimelineIcon";
import { useEffect, useId, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type {
  PyContentDependency,
  PyCatalogViewItem,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { cn } from "@/lib/utils";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import { Input } from "@/ui/components/input";
import { PencilSparklesIcon } from "@/ui/components/PencilSparklesIcon";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import { CatalogDragHandle } from "./ActionCatalogDrag";
import { CreatorPanelCollapseButton } from "./CreatorPanelChrome";
import type { ActionDependencySection } from "./ActionEditorWorkspaceContext";
import type { ActionComponentType } from "./actionDependencies";

import { SoundUploadButton } from "@/ui/sound-upload/SoundUploadButton";
import { SoundPickerPreview } from "@/ui/sound-preview/SoundPickerPreview";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";

type EffectTab = {
  contentType: ActionComponentType;
  icon: LucideIcon;
};

const EFFECT_TABS: EffectTab[] = [
  { contentType: "particle_effect", icon: SparklesIcon },
  { contentType: "avatar_effect", icon: UserRoundIcon },
  { contentType: "scene_effect", icon: Layers3Icon },
  { contentType: "sound_effect", icon: Volume2Icon },
];

/** The wording one effect catalog tab uses, each a whole phrase or sentence. */
type EffectTabText = {
  tab: string;
  search: string;
  loading: string;
  loadFailed: string;
  empty: string;
  showMore: string;
};

function effectTabText(
  t: TFunction<"actionEditor">,
  contentType: ActionComponentType,
): EffectTabText {
  switch (contentType) {
    case "particle_effect":
      return {
        tab: t("effects.types.particle.tab"),
        search: t("effects.types.particle.search"),
        loading: t("effects.types.particle.loading"),
        loadFailed: t("effects.types.particle.loadFailed"),
        empty: t("effects.types.particle.empty"),
        showMore: t("effects.types.particle.showMore"),
      };
    case "avatar_effect":
      return {
        tab: t("effects.types.avatar.tab"),
        search: t("effects.types.avatar.search"),
        loading: t("effects.types.avatar.loading"),
        loadFailed: t("effects.types.avatar.loadFailed"),
        empty: t("effects.types.avatar.empty"),
        showMore: t("effects.types.avatar.showMore"),
      };
    case "scene_effect":
      return {
        tab: t("effects.types.scene.tab"),
        search: t("effects.types.scene.search"),
        loading: t("effects.types.scene.loading"),
        loadFailed: t("effects.types.scene.loadFailed"),
        empty: t("effects.types.scene.empty"),
        showMore: t("effects.types.scene.showMore"),
      };
    case "sound_effect":
      return {
        tab: t("effects.types.sound.tab"),
        search: t("effects.types.sound.search"),
        loading: t("effects.types.sound.loading"),
        loadFailed: t("effects.types.sound.loadFailed"),
        empty: t("effects.types.sound.empty"),
        showMore: t("effects.types.sound.showMore"),
      };
  }
}

type ActionEditorEffectsPanelProps = {
  mobile?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  activeType: ActionComponentType;
  onActiveTypeChange: (contentType: ActionComponentType) => void;
  sections: ActionDependencySection[];
  dependencies: PyContentDependency[];
  onAdd: (item: PyCatalogViewItem, contentType: ActionComponentType) => void;
  timelineEnabled?: boolean;
  onTimelineEnabledChange?: (enabled: boolean) => void;
  /** Browser-local Pose drafts shown only by the Gesture creator. */
  poses?: PyPose[];
  posesPending?: boolean;
  posesError?: string | null;
  onRetryPoses?: () => void;
  onAddPose?: (pose: PyPose) => void;
  onEditPose?: (pose: PyPose) => void;
  onCreatePose?: () => void;
};

type PanelTab = "poses" | ActionComponentType;

/**
 * Metadata-first VFX/SFX browser shared by Gesture and Reaction creators.
 * Adding an item preserves the existing contract: select its stable catalog item and
 * insert a timeline event at the current playhead.
 */
export function ActionEditorEffectsPanel({
  mobile = false,
  expanded = true,
  onExpandedChange,
  query,
  onQueryChange,
  activeType,
  onActiveTypeChange,
  sections,
  dependencies,
  onAdd,
  timelineEnabled = true,
  onTimelineEnabledChange,
  poses,
  posesPending = false,
  posesError = null,
  onRetryPoses,
  onAddPose,
  onEditPose,
  onCreatePose,
}: ActionEditorEffectsPanelProps) {
  const { t } = useTranslation("actionEditor");
  const apiClient = useProductApiClient();

  const [previewState, setPreviewState] = useState<{
    id: string | null;
    error?: string;
  }>({ id: null });
  const preview = useMemo(
    () => new SoundPickerPreview((id, error) => setPreviewState({ id, error })),
    [],
  );
  useEffect(() => {
    const unsubscribe = usePoseCreatorStore.subscribe((state, previous) => {
      if (state.clipPlaybackPlaying && !previous.clipPlaybackPlaying)
        preview.stop();
    });
    return () => {
      unsubscribe();
      preview.stop();
    };
  }, [preview]);
  const showsPoses = poses !== undefined;
  const [panelTab, setPanelTab] = useState<PanelTab>(
    showsPoses ? "poses" : activeType,
  );
  useEffect(() => {
    preview.stop();
  }, [panelTab, preview]);
  const [poseQuery, setPoseQuery] = useState("");
  // Local Poses are the user's own ingredients; Included ones are opt-in.
  const [showIncludedPoses, setShowIncludedPoses] = useState(false);
  const showIncludedId = useId();
  const activeTab =
    EFFECT_TABS.find((tab) => tab.contentType === activeType) ?? EFFECT_TABS[0];
  const activeText = effectTabText(t, activeTab.contentType);
  const activeSection = sections.find(
    (section) => section.contentType === activeTab.contentType,
  );
  const filteredPoses = useMemo(() => {
    const normalizedQuery = poseQuery.trim().toLocaleLowerCase();
    return (poses ?? []).filter(
      (pose) =>
        (showIncludedPoses || pose.source !== "included") &&
        pose.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [poseQuery, poses, showIncludedPoses]);
  const panelLabel = showsPoses
    ? t("effects.titleWithPoses")
    : t("effects.title");

  return (
    <section
      className={cn(
        "bg-background flex h-full min-h-0 flex-col overflow-hidden border p-3 backdrop-blur-xl",
        mobile ? "border-0" : "rounded-2xl shadow-xl",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-start justify-between gap-3",
          expanded ? "min-h-7" : "min-h-10",
        )}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{panelLabel}</h2>
          {!expanded ? (
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {showsPoses
                ? t("effects.summary.posesAndEffects", {
                    poses: t("effects.summary.poses", { count: poses.length }),
                    effects: t("effects.summary.effects", {
                      count: dependencies.length,
                    }),
                  })
                : t("effects.summary.added", { count: dependencies.length })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onTimelineEnabledChange ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className={cn(
                "bg-background size-11 shrink-0 rounded-lg shadow-none lg:size-9",
                timelineEnabled &&
                  "border-primary/40 bg-primary/8 text-primary",
              )}
              aria-label={t("effects.showTimelineEvents")}
              aria-pressed={timelineEnabled}
              title={t("effects.showTimelineEvents")}
              onClick={() => onTimelineEnabledChange(!timelineEnabled)}
            >
              <TimelineIcon className="size-4" />
            </Button>
          ) : null}
          {!mobile && onExpandedChange ? (
            <CreatorPanelCollapseButton
              label={panelLabel}
              expanded={expanded}
              collapseDirection="up"
              onExpandedChange={onExpandedChange}
            />
          ) : null}
        </div>
      </div>

      {expanded ? (
        <Tabs
          value={panelTab}
          onValueChange={(value) => {
            if (value === "poses" && showsPoses) {
              setPanelTab("poses");
              return;
            }
            const tab = EFFECT_TABS.find(
              (candidate) => candidate.contentType === value,
            );
            if (tab) {
              setPanelTab(tab.contentType);
              onActiveTypeChange(tab.contentType);
            }
          }}
          className="mt-2 flex min-h-0 flex-1 flex-col"
        >
          <TabsList
            className={cn(
              "border-border/70 bg-muted/35 grid h-9 w-full shrink-0 rounded-lg border p-0.5",
              showsPoses ? "grid-cols-5" : "grid-cols-4",
            )}
          >
            {showsPoses ? (
              <TabsTrigger
                value="poses"
                className="text-2xs h-8 min-w-0 rounded-md px-1 tracking-tight data-[state=active]:shadow-sm"
              >
                <span className="truncate">{t("effects.poses.tab")}</span>
              </TabsTrigger>
            ) : null}
            {EFFECT_TABS.map((tab) => (
              <TabsTrigger
                key={tab.contentType}
                value={tab.contentType}
                className="text-2xs h-8 min-w-0 rounded-md px-1 tracking-tight data-[state=active]:shadow-sm"
              >
                <span className="truncate">
                  {effectTabText(t, tab.contentType).tab}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div
            className={cn(
              "mt-3 grid shrink-0 items-center gap-2",
              panelTab === "sound_effect" && "grid-cols-[minmax(0,1fr)_auto]",
            )}
          >
            <div className="relative min-w-0">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                className="h-9 pl-8 text-xs"
                value={panelTab === "poses" ? poseQuery : query}
                onChange={(event) => {
                  if (panelTab === "poses") setPoseQuery(event.target.value);
                  else onQueryChange(event.target.value);
                }}
                placeholder={
                  panelTab === "poses"
                    ? t("effects.poses.search")
                    : activeText.search
                }
                aria-label={
                  panelTab === "poses"
                    ? t("effects.poses.search")
                    : activeText.search
                }
              />
            </div>
            {panelTab === "sound_effect" ? (
              <SoundUploadButton className="contents [&>ul]:col-span-full" />
            ) : null}
          </div>
          {panelTab === "poses" ? (
            <label
              htmlFor={showIncludedId}
              className="mt-2 flex shrink-0 items-center gap-2 text-xs"
            >
              <Checkbox
                id={showIncludedId}
                checked={showIncludedPoses}
                onCheckedChange={(checked) =>
                  setShowIncludedPoses(checked === true)
                }
              />
              {t("effects.poses.showIncluded")}
            </label>
          ) : null}
          {previewState.error ? (
            <p role="alert" className="text-destructive mt-2 text-xs">
              {previewState.error}
            </p>
          ) : null}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
            {panelTab === "poses" ? (
              <PoseCatalog
                mobile={mobile}
                poses={filteredPoses}
                pending={posesPending}
                error={posesError}
                onRetry={onRetryPoses}
                hasQuery={Boolean(poseQuery.trim())}
                includedHidden={
                  !showIncludedPoses &&
                  (poses ?? []).some(
                    (pose) =>
                      pose.source === "included" &&
                      pose.name
                        .toLocaleLowerCase()
                        .includes(poseQuery.trim().toLocaleLowerCase()),
                  )
                }
                onAddPose={onAddPose}
                onEditPose={onEditPose}
                onCreatePose={onCreatePose}
              />
            ) : (
              <>
                {activeSection?.isPending ? (
                  <div
                    className="text-muted-foreground px-3 py-6 text-center text-xs"
                    role="status"
                  >
                    {activeText.loading}
                  </div>
                ) : activeSection?.errorMessage ? (
                  <div
                    className="border-destructive/40 bg-destructive/5 rounded-lg border px-3 py-4 text-center"
                    role="alert"
                  >
                    <p className="text-destructive text-xs font-medium">
                      {activeText.loadFailed}
                    </p>
                    <p className="text-muted-foreground text-2xs mt-1 line-clamp-2">
                      {activeSection.errorMessage}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 h-8 text-xs"
                      onClick={() => void activeSection.retry()}
                    >
                      {t("effects.tryAgain")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {activeSection?.items.map((item) => {
                      const addedCount = dependencyCount(
                        dependencies,
                        activeTab.contentType,
                        item.source,
                      );
                      return (
                        <EffectCatalogRow
                          key={item.item_id}
                          mobile={mobile}
                          contentType={activeTab.contentType}
                          item={item}
                          icon={activeTab.icon}
                          addedCount={addedCount}
                          onAdd={() => onAdd(item, activeTab.contentType)}
                          previewing={previewState.id === item.item_id}
                          onPreview={
                            activeTab.contentType === "sound_effect"
                              ? () => {
                                  if (previewState.id === item.item_id)
                                    preview.stop();
                                  else
                                    void preview.play(apiClient, item.item_id);
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}

                {!activeSection?.isPending &&
                !activeSection?.errorMessage &&
                !activeSection?.items.length ? (
                  <div className="border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-6 text-center">
                    <p className="text-sm font-medium">{t("effects.empty")}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {query ? t("effects.differentSearch") : activeText.empty}
                    </p>
                  </div>
                ) : null}

                {!activeSection?.isPending &&
                !activeSection?.errorMessage &&
                activeSection?.hasNextPage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-8 w-full text-xs"
                    disabled={activeSection.isFetchingNextPage}
                    onClick={() => void activeSection.fetchNextPage()}
                  >
                    {activeSection.isFetchingNextPage
                      ? t("effects.loadingMore")
                      : activeText.showMore}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </Tabs>
      ) : null}
    </section>
  );
}

/** Included and Local Pose library used as clip keyframe ingredients. */
function PoseCatalog({
  mobile,
  poses,
  hasQuery,
  includedHidden,
  pending,
  error,
  onRetry,
  onAddPose,
  onEditPose,
  onCreatePose,
}: {
  mobile: boolean;
  poses: PyPose[];
  hasQuery: boolean;
  /** Included Poses that match the search are filtered out. */
  includedHidden: boolean;
  pending?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onAddPose?: (pose: PyPose) => void;
  onEditPose?: (pose: PyPose) => void;
  onCreatePose?: () => void;
}) {
  const { t } = useTranslation("actionEditor");
  if (pending)
    return (
      <p className="text-muted-foreground text-xs">
        {t("effects.poses.loading")}
      </p>
    );
  if (error)
    return (
      <div role="alert" className="text-destructive text-xs">
        {t("effects.poses.loadFailed")} {error}
        <Button variant="ghost" onClick={onRetry}>
          {t("effects.tryAgain")}
        </Button>
      </div>
    );
  return (
    <>
      {poses.length ? (
        <div className="space-y-1.5">
          {poses.map((pose) => (
            <div
              key={pose.item_id}
              className="border-border/70 bg-background/65 hover:bg-accent/45 group flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors"
            >
              <CatalogDragHandle
                item={{ kind: "pose", pose }}
                disabled={mobile || !onAddPose}
              >
                <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                  <PersonStandingIcon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{pose.name}</p>
                  <p className="text-muted-foreground text-2xs">
                    {pose.source === "included"
                      ? t("effects.poses.included")
                      : t("effects.poses.local")}
                  </p>
                </div>
              </CatalogDragHandle>
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 shrink-0 rounded-full"
                    onClick={() => onEditPose?.(pose)}
                    disabled={!onEditPose}
                    aria-label={t("effects.poses.editNamed", {
                      name: pose.name,
                    })}
                  >
                    <PencilSparklesIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("effects.poses.edit")}</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 shrink-0 rounded-full"
                    onClick={() => onAddPose?.(pose)}
                    disabled={!onAddPose}
                    aria-label={t("effects.poses.insertNamed", {
                      name: pose.name,
                    })}
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("effects.poses.insert")}</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-6 text-center">
          <p className="text-sm font-medium">
            {hasQuery ? t("effects.poses.noMatches") : t("effects.poses.none")}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {hasQuery
              ? includedHidden
                ? t("effects.poses.differentSearchOrIncluded")
                : t("effects.differentSearch")
              : includedHidden
                ? t("effects.poses.createHintOrIncluded")
                : t("effects.poses.createHint")}
          </p>
          {!hasQuery ? (
            <Button
              className="mt-3"
              size="sm"
              onClick={onCreatePose}
              disabled={!onCreatePose}
            >
              {t("effects.poses.create")}
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}

function EffectCatalogRow({
  mobile,
  contentType,
  item,
  icon: Icon,
  addedCount,
  onAdd,
  previewing,
  onPreview,
}: {
  mobile: boolean;
  contentType: ActionComponentType;
  item: PyCatalogViewItem;
  icon: LucideIcon;
  addedCount: number;
  previewing?: boolean;
  onPreview?: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation("actionEditor");
  return (
    <div className="border-border/70 bg-background/65 hover:bg-accent/45 group flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors">
      <CatalogDragHandle
        item={{ kind: "effect", item, contentType }}
        disabled={mobile || !item.source}
      >
        <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{item.name}</p>
          <div className="text-muted-foreground text-2xs flex items-center gap-1.5">
            {item.origin !== "builtin" ? (
              <span>{t("effects.mine")}</span>
            ) : null}
            {addedCount ? (
              <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-medium">
                {addedCount === 1
                  ? t("effects.added")
                  : t("effects.addedTimes", { times: addedCount })}
              </span>
            ) : null}
          </div>
        </div>
      </CatalogDragHandle>
      {onPreview ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7 shrink-0 rounded-full"
          disabled={!item.source}
          onClick={onPreview}
          aria-label={
            previewing
              ? t("effects.stop", { name: item.name })
              : t("effects.play", { name: item.name })
          }
        >
          {previewing ? (
            <SquareIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-7 rounded-full"
        disabled={!item.source}
        onClick={onAdd}
        aria-label={
          contentType === "sound_effect"
            ? t("effects.addToTimeline", { name: item.name })
            : t("effects.addAtPlayhead", { name: item.name })
        }
        title={
          item.source
            ? t("effects.addAtPlayheadTitle")
            : t("effects.contentUnavailable")
        }
      >
        <PlusIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function dependencyCount(
  dependencies: PyContentDependency[],
  contentType: ActionComponentType,
  source: PyExactContentSource | null,
) {
  const key = exactSourceKey(source);
  if (!key) return 0;
  return dependencies.filter(
    (dependency) =>
      dependency.content_type === contentType &&
      exactSourceKey(dependency.source) === key,
  ).length;
}

function exactSourceKey(source: PyExactContentSource | null | undefined) {
  if (!source) return null;
  return source.type === "catalog"
    ? `catalog:${source.catalog_item_id}`
    : source.content_id && source.version != null
      ? `builtin:${source.content_id}@${source.version}`
      : null;
}
