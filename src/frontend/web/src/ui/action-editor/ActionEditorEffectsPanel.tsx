"use client";

import {
  Layers3Icon,
  PersonStandingIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  UserRoundIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  PyContentDependency,
  PyCatalogViewItem,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { cn } from "@/lib/utils";
import type { PoseCreatorSavedDraft } from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { CreatorPanelCollapseButton } from "./CreatorPanelChrome";
import type { ActionDependencySection } from "./ActionEditorWorkspaceContext";
import type { ActionComponentType } from "./actionDependencies";

type EffectTab = {
  contentType: ActionComponentType;
  label: string;
  catalogLabel: string;
  searchPlaceholder: string;
  icon: LucideIcon;
};

const EFFECT_TABS: EffectTab[] = [
  {
    contentType: "particle_effect",
    label: "Particle FX",
    catalogLabel: "Particle effects",
    searchPlaceholder: "Search particle effects",
    icon: SparklesIcon,
  },
  {
    contentType: "avatar_effect",
    label: "Avatar FX",
    catalogLabel: "Avatar effects",
    searchPlaceholder: "Search avatar effects",
    icon: UserRoundIcon,
  },
  {
    contentType: "scene_effect",
    label: "Scene FX",
    catalogLabel: "Scene effects",
    searchPlaceholder: "Search scene effects",
    icon: Layers3Icon,
  },
  {
    contentType: "sound_effect",
    label: "SFX",
    catalogLabel: "Sound effects",
    searchPlaceholder: "Search sound effects",
    icon: Volume2Icon,
  },
];

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
  onRemove: (alias: string) => void;
  /** Browser-local Pose drafts shown only by the Gesture creator. */
  poses?: PoseCreatorSavedDraft[];
  onAddPose?: (pose: PoseCreatorSavedDraft) => void;
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
  onRemove,
  poses,
  onAddPose,
}: ActionEditorEffectsPanelProps) {
  const showsPoses = poses !== undefined;
  const [panelTab, setPanelTab] = useState<PanelTab>(
    showsPoses ? "poses" : activeType,
  );
  const [poseQuery, setPoseQuery] = useState("");
  const activeTab =
    EFFECT_TABS.find((tab) => tab.contentType === activeType) ?? EFFECT_TABS[0];
  const activeSection = sections.find(
    (section) => section.contentType === activeTab.contentType,
  );
  const itemsByType = useMemo(
    () =>
      new Map(
        sections.map(
          (section) => [section.contentType, section.items] as const,
        ),
      ),
    [sections],
  );
  const filteredPoses = useMemo(() => {
    const normalizedQuery = poseQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return poses ?? [];
    return (poses ?? []).filter((pose) =>
      pose.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [poseQuery, poses]);
  const panelLabel = showsPoses ? "Poses & Effects" : "Effects";

  return (
    <section
      className={cn(
        "bg-background/92 flex h-full min-h-0 flex-col overflow-hidden border p-3 backdrop-blur-xl",
        mobile ? "border-0" : "rounded-2xl shadow-xl",
      )}
    >
      <div className="flex min-h-10 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{panelLabel}</h2>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {expanded
              ? showsPoses
                ? "Add poses, visuals, and sound at the playhead."
                : "Add visuals and sound at the playhead."
              : showsPoses
                ? `${poses.length} poses · ${dependencies.length} effects`
                : `${dependencies.length} added`}
          </p>
        </div>
        {!mobile && onExpandedChange ? (
          <CreatorPanelCollapseButton
            label={panelLabel.toLocaleLowerCase()}
            expanded={expanded}
            collapseDirection="up"
            onExpandedChange={onExpandedChange}
          />
        ) : null}
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
          className="mt-3 flex min-h-0 flex-1 flex-col"
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
                className="h-8 min-w-0 rounded-md px-1 text-[10px] tracking-tight data-[state=active]:shadow-sm 2xl:text-[11px]"
              >
                <span className="truncate">Poses</span>
              </TabsTrigger>
            ) : null}
            {EFFECT_TABS.map((tab) => (
              <TabsTrigger
                key={tab.contentType}
                value={tab.contentType}
                className="h-8 min-w-0 rounded-md px-1 text-[10px] tracking-tight data-[state=active]:shadow-sm 2xl:text-[11px]"
              >
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="relative mt-3 shrink-0">
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
                  ? "Search saved poses"
                  : activeTab.searchPlaceholder
              }
              aria-label={
                panelTab === "poses"
                  ? "Search saved poses"
                  : activeTab.searchPlaceholder
              }
            />
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
            {panelTab === "poses" ? (
              <PoseCatalog
                poses={filteredPoses}
                hasQuery={Boolean(poseQuery.trim())}
                onAddPose={onAddPose}
              />
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    {activeTab.catalogLabel}
                  </p>
                  <span className="text-muted-foreground text-[10px]">
                    At current time
                  </span>
                </div>

                {activeSection?.isPending ? (
                  <div
                    className="text-muted-foreground px-3 py-6 text-center text-xs"
                    role="status"
                  >
                    Loading {activeTab.catalogLabel.toLowerCase()}…
                  </div>
                ) : activeSection?.errorMessage ? (
                  <div
                    className="border-destructive/40 bg-destructive/5 rounded-lg border px-3 py-4 text-center"
                    role="alert"
                  >
                    <p className="text-destructive text-xs font-medium">
                      Could not load {activeTab.catalogLabel.toLowerCase()}
                    </p>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-[11px]">
                      {activeSection.errorMessage}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 h-8 text-xs"
                      onClick={() => void activeSection.retry()}
                    >
                      Try again
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
                          item={item}
                          icon={activeTab.icon}
                          addedCount={addedCount}
                          onAdd={() => onAdd(item, activeTab.contentType)}
                        />
                      );
                    })}
                  </div>
                )}

                {!activeSection?.isPending &&
                !activeSection?.errorMessage &&
                !activeSection?.items.length ? (
                  <div className="border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-6 text-center">
                    <p className="text-sm font-medium">No effects found</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {query
                        ? "Try a different search."
                        : `No ${activeTab.catalogLabel.toLowerCase()} are available.`}
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
                      ? "Loading more…"
                      : `Show more ${activeTab.catalogLabel.toLowerCase()}`}
                  </Button>
                ) : null}

                {dependencies.length ? (
                  <div className="border-border/70 mt-4 border-t pt-3">
                    <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
                      Added to timeline · {dependencies.length}
                    </p>
                    <div className="space-y-1.5">
                      {dependencies.map((dependency) => (
                        <AddedEffectRow
                          key={dependency.alias}
                          dependency={dependency}
                          items={itemsByType.get(dependency.content_type) ?? []}
                          onRemove={() => onRemove(dependency.alias)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Tabs>
      ) : null}
    </section>
  );
}

/** Browser-local Pose library used as clip keyframe ingredients. */
function PoseCatalog({
  poses,
  hasQuery,
  onAddPose,
}: {
  poses: PoseCreatorSavedDraft[];
  hasQuery: boolean;
  onAddPose?: (pose: PoseCreatorSavedDraft) => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          My saved poses
        </p>
        <span className="text-muted-foreground text-[10px]">
          At current time
        </span>
      </div>
      {poses.length ? (
        <div className="space-y-1.5">
          {poses.map((pose) => (
            <div
              key={pose.id}
              className="border-border/70 bg-background/65 hover:bg-accent/45 group flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors"
            >
              <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                <PersonStandingIcon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{pose.name}</p>
                <p className="text-muted-foreground truncate text-[10px]">
                  Saved in this browser
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-7 rounded-full"
                onClick={() => onAddPose?.(pose)}
                disabled={!onAddPose}
                aria-label={`Add ${pose.name} at current playhead`}
                title="Add pose at current playhead"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-6 text-center">
          <p className="text-sm font-medium">
            {hasQuery ? "No poses found" : "No saved poses yet"}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {hasQuery
              ? "Try a different search."
              : "Create and save a Pose to reuse it as a Gesture keyframe."}
          </p>
        </div>
      )}
    </>
  );
}

function EffectCatalogRow({
  item,
  icon: Icon,
  addedCount,
  onAdd,
}: {
  item: PyCatalogViewItem;
  icon: LucideIcon;
  addedCount: number;
  onAdd: () => void;
}) {
  return (
    <div className="border-border/70 bg-background/65 hover:bg-accent/45 group flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors">
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{item.name}</p>
        <div className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
          <span>{item.origin === "builtin" ? "Built-in" : "Mine"}</span>
          {addedCount ? (
            <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-medium">
              {addedCount === 1 ? "Added" : `Added ×${addedCount}`}
            </span>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-7 rounded-full"
        disabled={!item.source}
        onClick={onAdd}
        aria-label={`Add ${item.name} at current playhead`}
        title={
          item.source ? "Add at current playhead" : "Content is unavailable"
        }
      >
        <PlusIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function AddedEffectRow({
  dependency,
  items,
  onRemove,
}: {
  dependency: PyContentDependency;
  items: PyCatalogViewItem[];
  onRemove: () => void;
}) {
  const tab =
    EFFECT_TABS.find(
      (candidate) => candidate.contentType === dependency.content_type,
    ) ?? EFFECT_TABS[0];
  const Icon = tab.icon;
  const item = items.find(
    (candidate) =>
      exactSourceKey(candidate.source) === exactSourceKey(dependency.source),
  );
  return (
    <div className="bg-muted/45 flex min-h-10 items-center gap-2 rounded-lg px-2 py-1.5">
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {item?.name ?? humanizeAlias(dependency.alias)}
        </p>
        <p className="text-muted-foreground truncate text-[10px]">
          {tab.label}
        </p>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-7 rounded-full"
        onClick={onRemove}
        aria-label={`Remove ${item?.name ?? dependency.alias} and its timeline events`}
        title="Remove effect and its timeline events"
      >
        <XIcon className="size-3.5" />
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

function humanizeAlias(alias: string) {
  return alias
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
