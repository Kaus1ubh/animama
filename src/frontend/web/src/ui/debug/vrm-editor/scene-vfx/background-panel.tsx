"use client";

import {
  SCENE_BACKGROUND_DIRECTIONS,
  SCENE_BACKGROUND_ITEM_ROTATION_MODES,
  SCENE_BACKGROUND_PATTERN_KINDS,
  type SceneBackgroundDirection,
  type SceneBackgroundItemRotationMode,
  type SceneBackgroundPatternKind,
} from "@/lib/scene-vfx/types";
import { SCENE_VFX_PRESET_IDS } from "@/lib/scene-vfx/presets";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import {
  ColorInputControl,
  NumberInputControl,
  Panel,
  SelectControl,
} from "../controls";
import type { SceneBackgroundDraftController } from "./use-scene-vfx-drafts";

export function SceneBackgroundPanel({
  controller,
}: {
  controller: SceneBackgroundDraftController;
}) {
  const {
    activeRuntime,
    draft,
    resetBase,
    presetId,
    previewActive,
    updateDraft,
    handlePresetSelect,
    handlePreview,
    handleApply,
    handleResetDraft,
    handleClearLive,
  } = controller;

  if (!draft) {
    return null;
  }

  return (
    <Panel
      title="Background layers"
      description="Author a scene-scoped DOM effect with static layers plus the animated marquee overlay."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={handlePreview}>
            {previewActive ? "Update Preview" : "Preview"}
          </Button>
          <Button type="button" size="sm" onClick={handleApply}>
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleResetDraft}
            disabled={!resetBase}
          >
            Reset draft
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleClearLive}
            disabled={!activeRuntime && !previewActive}
          >
            Clear live
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  enabled: checked,
                }))
              }
              aria-label="Toggle scene background effect"
            />
            <span>Enabled</span>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
              Preset
            </span>
            <SelectControl value={presetId} onChange={handlePresetSelect}>
              {SCENE_VFX_PRESET_IDS.map((nextPresetId) => (
                <option key={nextPresetId} value={nextPresetId}>
                  {nextPresetId}
                </option>
              ))}
              <option value="custom" disabled>
                custom
              </option>
            </SelectControl>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
              Duration
            </span>
            <NumberInputControl
              value={
                typeof draft.durationMs === "number"
                  ? draft.durationMs
                  : undefined
              }
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  durationMs: value ?? null,
                }))
              }
              step="100"
            />
          </label>
          <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Switch
              checked={draft.durationMs === null}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  durationMs: checked
                    ? null
                    : typeof current.durationMs === "number"
                      ? current.durationMs
                      : 5000,
                }))
              }
              aria-label="Toggle sticky preview duration"
            />
            <span>Sticky duration</span>
          </label>
          <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Switch
              checked={draft.coverUiOverlays ?? false}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  coverUiOverlays: checked,
                }))
              }
              aria-label="Toggle cover UI overlays"
            />
            <span>Cover UI overlays</span>
          </label>
          <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Switch
              checked={draft.dismissOnInput ?? true}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  dismissOnInput: checked,
                }))
              }
              aria-label="Toggle dismiss on input"
            />
            <span>Dismiss on input</span>
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
            Solid
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Switch
                checked={draft.solid.enabled}
                onCheckedChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    solid: {
                      ...current.solid,
                      enabled: checked,
                    },
                  }))
                }
                aria-label="Toggle solid layer"
              />
              <span>Solid enabled</span>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Solid color
              </span>
              <ColorInputControl
                value={draft.solid.color}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    solid: {
                      ...current.solid,
                      color: value,
                    },
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
            Pattern
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Switch
                checked={draft.pattern.enabled}
                onCheckedChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      enabled: checked,
                    },
                  }))
                }
                aria-label="Toggle pattern layer"
              />
              <span>Pattern enabled</span>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Pattern kind
              </span>
              <SelectControl
                value={draft.pattern.pattern}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      pattern: value as SceneBackgroundPatternKind,
                    },
                  }))
                }
              >
                {SCENE_BACKGROUND_PATTERN_KINDS.map((pattern) => (
                  <option key={pattern} value={pattern}>
                    {pattern}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Pattern color
              </span>
              <ColorInputControl
                value={draft.pattern.color}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      color: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Pattern size
              </span>
              <NumberInputControl
                value={draft.pattern.size}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      size: value ?? 24,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Pattern spacing
              </span>
              <NumberInputControl
                value={draft.pattern.spacing}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      spacing: value ?? 18,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Pattern opacity
              </span>
              <NumberInputControl
                value={draft.pattern.opacity}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    pattern: {
                      ...current.pattern,
                      opacity: value ?? 0.4,
                    },
                  }))
                }
                step="0.05"
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
            Marquee
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Switch
                checked={draft.marquee.enabled}
                onCheckedChange={(checked) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      enabled: checked,
                    },
                  }))
                }
                aria-label="Toggle marquee layer"
              />
              <span>Marquee enabled</span>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Direction
              </span>
              <SelectControl
                value={draft.marquee.direction}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      direction: value as SceneBackgroundDirection,
                    },
                  }))
                }
              >
                {SCENE_BACKGROUND_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Item size
              </span>
              <NumberInputControl
                value={draft.marquee.itemSize}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      itemSize: value ?? 72,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Item rotation
              </span>
              <SelectControl
                value={draft.marquee.itemRotationMode}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      itemRotationMode:
                        value as SceneBackgroundItemRotationMode,
                    },
                  }))
                }
              >
                {SCENE_BACKGROUND_ITEM_ROTATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Rotation offset deg
              </span>
              <NumberInputControl
                value={draft.marquee.itemRotationOffsetDeg}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      itemRotationOffsetDeg: value ?? 0,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Gap
              </span>
              <NumberInputControl
                value={draft.marquee.gap}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      gap: value ?? 24,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Row gap
              </span>
              <NumberInputControl
                value={draft.marquee.rowGap}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      rowGap: value ?? 20,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Speed px/sec
              </span>
              <NumberInputControl
                value={draft.marquee.speedPxPerSec}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      speedPxPerSec: value ?? 160,
                    },
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                Marquee opacity
              </span>
              <NumberInputControl
                value={draft.marquee.opacity}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    marquee: {
                      ...current.marquee,
                      opacity: value ?? 0.95,
                    },
                  }))
                }
                step="0.05"
              />
            </label>
          </div>
        </div>
      </div>
    </Panel>
  );
}
