"use client";

import { ChevronUpIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  readAvailableAvatarExpressions,
  readAvatarExpressionOverrideValue,
  readAvatarExpressionValue,
} from "@/lib/avatar/expressionUtils";
import { cn } from "@/lib/utils";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Slider } from "@/ui/components/slider";
import { PoseCreatorPanelSection } from "./PoseCreatorPanelSection";
import {
  clampExpressionWeight,
  formatExpressionWeight,
} from "./poseCreatorAuthoring";
import {
  usePoseCreatorClipUndoGrouping,
  usePoseCreatorUndoGrouping,
} from "./usePoseCreatorUndoGrouping";

function formatExpressionLabel(expressionName: string): string {
  const spaced = expressionName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function PoseCreatorExpressionSection({
  variant = "panel",
  onCollapse,
  embedded = false,
  timelineValues,
  onTimelineExpressionChange,
  onTimelineExpressionsClear,
}: {
  variant?: "panel" | "workspace" | "mobile";
  onCollapse?: () => void;
  /** Render only the reusable controls inside parent-owned panel chrome. */
  embedded?: boolean;
  /** Controlled, sampled timeline values used by the Reaction creator. */
  timelineValues?: Record<string, number>;
  onTimelineExpressionChange?: (expressionName: string, value: number) => void;
  onTimelineExpressionsClear?: () => void;
}) {
  const [expressionSearch, setExpressionSearch] = useState("");
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const selectedBone = usePoseCreatorStore((state) => state.selectedBone);
  const expressionDrafts = usePoseCreatorStore(
    (state) => state.expressionDrafts,
  );
  const setExpressionDraft = usePoseCreatorStore(
    (state) => state.setExpressionDraft,
  );
  const removeExpressionDraft = usePoseCreatorStore(
    (state) => state.removeExpressionDraft,
  );
  const clearExpressionDrafts = usePoseCreatorStore(
    (state) => state.clearExpressionDrafts,
  );
  const poseUndoGrouping = usePoseCreatorUndoGrouping();
  const clipUndoGrouping = usePoseCreatorClipUndoGrouping();
  const timelineControlled = timelineValues !== undefined;
  const { beginUndoGroup, endUndoGroup } = timelineControlled
    ? clipUndoGrouping
    : poseUndoGrouping;

  const expressionNames = useMemo(
    () => readAvailableAvatarExpressions(activeAvatar),
    [activeAvatar],
  );
  const activeDraftCount = timelineControlled
    ? Object.values(timelineValues).filter((value) => Math.abs(value) > 1e-6)
        .length
    : Object.keys(expressionDrafts).length;
  const filteredExpressionNames = useMemo(() => {
    const query = expressionSearch.trim().toLowerCase();
    if (!query) return expressionNames;
    return expressionNames.filter(
      (expressionName) =>
        expressionName.toLowerCase().includes(query) ||
        formatExpressionLabel(expressionName).toLowerCase().includes(query),
    );
  }, [expressionNames, expressionSearch]);

  const handleExpressionChange = (expressionName: string, value: number) => {
    if (!activeAvatar) return;
    const nextValue = clampExpressionWeight(value);
    if (timelineControlled) {
      activeAvatar.setExpression(expressionName, nextValue);
      activeAvatar.vrm?.update(0);
      onTimelineExpressionChange?.(expressionName, nextValue);
      return;
    }
    const existingDraft = expressionDrafts[expressionName];
    const baseValue =
      existingDraft?.baseValue ??
      readAvatarExpressionValue(activeAvatar, expressionName);
    activeAvatar.setExpression(expressionName, nextValue);
    activeAvatar.vrm?.update(0);
    setExpressionDraft(expressionName, {
      baseValue,
      value: nextValue,
    });
  };

  const handleClearExpression = (expressionName: string) => {
    if (!activeAvatar) return;
    if (timelineControlled) {
      onTimelineExpressionChange?.(expressionName, 0);
      return;
    }
    activeAvatar.clearExpressionOverride(expressionName);
    activeAvatar.vrm?.update(0);
    removeExpressionDraft(expressionName);
  };

  const handleClearAllExpressions = () => {
    if (!activeAvatar) return;
    if (timelineControlled) {
      onTimelineExpressionsClear?.();
      return;
    }
    for (const expressionName of expressionNames) {
      activeAvatar.clearExpressionOverride(expressionName);
    }
    activeAvatar.vrm?.update(0);
    clearExpressionDrafts();
  };

  if (variant !== "panel") {
    return (
      <aside
        className={cn(
          "border-border/65 bg-background/92 pointer-events-auto flex flex-col overflow-hidden border p-4 backdrop-blur-xl",
          embedded
            ? "h-full min-h-0 w-full border-0 bg-transparent p-0 backdrop-blur-none"
            : variant === "mobile"
              ? "h-full min-h-0 w-full border-0 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              : cn(
                  "absolute right-4 bottom-4 w-[248px] rounded-2xl shadow-xl shadow-black/8 transition-[top] xl:right-8 xl:w-[296px] 2xl:w-[308px] [@media(min-height:800px)]:bottom-[6rem]",
                  selectedBone ? "top-[19.5rem]" : "top-[5.75rem]",
                ),
        )}
      >
        {!embedded ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Expressions</h2>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {expressionNames.length} available
              </p>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={handleClearAllExpressions}
              disabled={!activeAvatar || activeDraftCount === 0}
              aria-label="Clear all expression changes"
            >
              <RotateCcwIcon className="size-3.5" />
            </Button>
            {variant === "workspace" && onCollapse ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground size-7"
                onClick={onCollapse}
                aria-label="Collapse expressions"
                title="Collapse expressions"
              >
                <ChevronUpIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              value={expressionSearch}
              onChange={(event) =>
                setExpressionSearch(event.currentTarget.value)
              }
              placeholder="Search expressions"
              aria-label="Search expressions"
              className="bg-background/70 h-9 rounded-lg pl-9 text-xs shadow-none"
            />
          </div>
          {embedded ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground size-8 shrink-0"
              onClick={handleClearAllExpressions}
              disabled={!activeAvatar || activeDraftCount === 0}
              aria-label="Clear all expression changes"
            >
              <RotateCcwIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>

        {filteredExpressionNames.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-xs">
            {expressionNames.length === 0
              ? "No expressions available"
              : "No matching expressions"}
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filteredExpressionNames.map((expressionName) => {
              const draft = expressionDrafts[expressionName] ?? null;
              const overrideValue = readAvatarExpressionOverrideValue(
                activeAvatar,
                expressionName,
              );
              const currentValue = timelineControlled
                ? (timelineValues[expressionName] ?? 0)
                : (draft?.value ??
                  readAvatarExpressionValue(activeAvatar, expressionName));
              const hasOverride = timelineControlled
                ? Math.abs(currentValue) > 1e-6
                : draft !== null || overrideValue !== null;

              return (
                <div
                  key={expressionName}
                  className="grid grid-cols-[76px_minmax(0,1fr)_42px] items-center gap-2 py-1.5"
                >
                  <span
                    className={cn(
                      "truncate text-[11px] font-medium",
                      hasOverride ? "text-foreground" : "text-muted-foreground",
                    )}
                    title={expressionName}
                  >
                    {formatExpressionLabel(expressionName)}
                  </span>
                  <Slider
                    value={[currentValue]}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!activeAvatar}
                    onValueChange={(values) => {
                      const [value] = values;
                      if (typeof value === "number") {
                        handleExpressionChange(expressionName, value);
                      }
                    }}
                    onPointerDown={beginUndoGroup}
                    onPointerUp={endUndoGroup}
                    onPointerCancel={endUndoGroup}
                    onKeyDown={beginUndoGroup}
                    onKeyUp={endUndoGroup}
                    onBlur={endUndoGroup}
                    className="[&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:shadow-sm [&_[data-slot=slider-track]]:h-1.5"
                    aria-label={`Expression ${expressionName}`}
                  />
                  <button
                    type="button"
                    className={cn(
                      "text-right font-mono text-[10px] tabular-nums",
                      hasOverride
                        ? "text-foreground hover:text-primary cursor-pointer"
                        : "text-muted-foreground cursor-default",
                    )}
                    onClick={() =>
                      hasOverride && handleClearExpression(expressionName)
                    }
                    disabled={!hasOverride}
                    title={
                      hasOverride ? "Clear expression override" : undefined
                    }
                  >
                    {Math.round(currentValue * 100)}%
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </aside>
    );
  }

  return (
    <PoseCreatorPanelSection
      title="Expression Authoring"
      subtitle={`${expressionNames.length} expressions available`}
      actions={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleClearAllExpressions}
          disabled={!activeAvatar || activeDraftCount === 0}
          className="h-7 px-2 text-xs"
        >
          <RotateCcwIcon className="size-3.5" />
          Clear all
        </Button>
      }
    >
      {expressionNames.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Load a VRM with registered expressions to edit facial weights.
        </p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {expressionNames.map((expressionName) => {
            const draft = expressionDrafts[expressionName] ?? null;
            const overrideValue = readAvatarExpressionOverrideValue(
              activeAvatar,
              expressionName,
            );
            const currentValue = timelineControlled
              ? (timelineValues[expressionName] ?? 0)
              : (draft?.value ??
                readAvatarExpressionValue(activeAvatar, expressionName));
            const hasOverride = timelineControlled
              ? Math.abs(currentValue) > 1e-6
              : draft !== null || overrideValue !== null;

            return (
              <div
                key={expressionName}
                className={cn(
                  "rounded-md border px-2.5 py-2",
                  hasOverride
                    ? "border-sky-500/40 bg-sky-500/5"
                    : "border-border/60 bg-background",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span
                    className="min-w-0 truncate font-mono text-[11px]"
                    title={expressionName}
                  >
                    {expressionName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                      {formatExpressionWeight(currentValue)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleClearExpression(expressionName)}
                      disabled={!hasOverride}
                      className="h-6 px-1.5 text-[10px]"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <Slider
                  value={[currentValue]}
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={!activeAvatar}
                  onValueChange={(values) => {
                    const [value] = values;
                    if (typeof value === "number") {
                      handleExpressionChange(expressionName, value);
                    }
                  }}
                  onPointerDown={beginUndoGroup}
                  onPointerUp={endUndoGroup}
                  onPointerCancel={endUndoGroup}
                  onKeyDown={beginUndoGroup}
                  onKeyUp={endUndoGroup}
                  onBlur={endUndoGroup}
                  aria-label={`Expression ${expressionName}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </PoseCreatorPanelSection>
  );
}
