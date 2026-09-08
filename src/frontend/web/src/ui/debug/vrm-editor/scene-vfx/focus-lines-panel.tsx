"use client";

import {
  DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX,
  DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX,
  SCENE_FOCUS_LINES_RENDER_PLACEMENTS,
  SCENE_FOCUS_LINES_TARGET_KINDS,
  type SceneFocusLinesRenderPlacement,
} from "@/lib/scene-vfx/types";
import { SCENE_FOCUS_LINES_VFX_PRESET_IDS } from "@/lib/scene-vfx/presets";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import {
  ColorInputControl,
  NumberInputControl,
  Panel,
  SelectControl,
} from "../controls";
import type { SceneFocusLinesDraftController } from "./use-scene-vfx-drafts";

export function SceneFocusLinesPanel({
  controller,
}: {
  controller: SceneFocusLinesDraftController;
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

  const manualFocusRect =
    draft.target.kind === "manual_box" ? draft.target.rect : null;

  return (
    <Panel
      title="Focus lines"
      description="Author screen-space manga focus lines that can render behind the avatar or over the avatar."
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
              aria-label="Toggle focus lines effect"
            />
            <span>Enabled</span>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Preset
            </span>
            <SelectControl value={presetId} onChange={handlePresetSelect}>
              {SCENE_FOCUS_LINES_VFX_PRESET_IDS.map((nextPresetId) => (
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
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
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
              aria-label="Toggle sticky focus-line duration"
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
              aria-label="Toggle focus-line cover UI overlays"
            />
            <span>Cover UI overlays</span>
          </label>
          <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Switch
              checked={draft.dismissOnInput ?? false}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  dismissOnInput: checked,
                }))
              }
              aria-label="Toggle focus-line dismiss on input"
            />
            <span>Dismiss on input</span>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Render placement
            </span>
            <SelectControl
              value={draft.renderPlacement}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  renderPlacement: value as SceneFocusLinesRenderPlacement,
                }))
              }
            >
              {SCENE_FOCUS_LINES_RENDER_PLACEMENTS.map((placement) => (
                <option key={placement} value={placement}>
                  {placement}
                </option>
              ))}
            </SelectControl>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Target kind
            </span>
            <SelectControl
              value={draft.target.kind}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  target:
                    value === "manual_box"
                      ? {
                          kind: "manual_box",
                          rect:
                            current.target.kind === "manual_box"
                              ? { ...current.target.rect }
                              : {
                                  x: 0.33,
                                  y: 0.18,
                                  width: 0.34,
                                  height: 0.42,
                                },
                        }
                      : {
                          kind: "avatar_face",
                          paddingXPx:
                            current.target.kind === "avatar_face"
                              ? current.target.paddingXPx
                              : DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX,
                          paddingYPx:
                            current.target.kind === "avatar_face"
                              ? current.target.paddingYPx
                              : DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX,
                        },
                }))
              }
            >
              {SCENE_FOCUS_LINES_TARGET_KINDS.map((targetKind) => (
                <option key={targetKind} value={targetKind}>
                  {targetKind}
                </option>
              ))}
            </SelectControl>
          </label>
        </div>

        {draft.target.kind === "avatar_face" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Face padding X px
              </span>
              <NumberInputControl
                value={draft.target.paddingXPx}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    target:
                      current.target.kind === "avatar_face"
                        ? {
                            ...current.target,
                            paddingXPx:
                              value ??
                              DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX,
                          }
                        : current.target,
                  }))
                }
                step="1"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Face padding Y px
              </span>
              <NumberInputControl
                value={draft.target.paddingYPx}
                onChange={(value) =>
                  updateDraft((current) => ({
                    ...current,
                    target:
                      current.target.kind === "avatar_face"
                        ? {
                            ...current.target,
                            paddingYPx:
                              value ??
                              DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX,
                          }
                        : current.target,
                  }))
                }
                step="1"
              />
            </label>
          </div>
        ) : null}

        {manualFocusRect ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Manual box
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  X
                </span>
                <NumberInputControl
                  value={manualFocusRect.x}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      target:
                        current.target.kind === "manual_box"
                          ? {
                              ...current.target,
                              rect: {
                                ...current.target.rect,
                                x: value ?? 0,
                              },
                            }
                          : current.target,
                    }))
                  }
                  step="0.01"
                />
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Y
                </span>
                <NumberInputControl
                  value={manualFocusRect.y}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      target:
                        current.target.kind === "manual_box"
                          ? {
                              ...current.target,
                              rect: {
                                ...current.target.rect,
                                y: value ?? 0,
                              },
                            }
                          : current.target,
                    }))
                  }
                  step="0.01"
                />
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Width
                </span>
                <NumberInputControl
                  value={manualFocusRect.width}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      target:
                        current.target.kind === "manual_box"
                          ? {
                              ...current.target,
                              rect: {
                                ...current.target.rect,
                                width: value ?? 0.34,
                              },
                            }
                          : current.target,
                    }))
                  }
                  step="0.01"
                />
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Height
                </span>
                <NumberInputControl
                  value={manualFocusRect.height}
                  onChange={(value) =>
                    updateDraft((current) => ({
                      ...current,
                      target:
                        current.target.kind === "manual_box"
                          ? {
                              ...current.target,
                              rect: {
                                ...current.target.rect,
                                height: value ?? 0.42,
                              },
                            }
                          : current.target,
                    }))
                  }
                  step="0.01"
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Line count
            </span>
            <NumberInputControl
              value={draft.lineCount}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  lineCount: value ?? 100,
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Color
            </span>
            <ColorInputControl
              value={draft.color}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  color: value,
                }))
              }
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Opacity
            </span>
            <NumberInputControl
              value={draft.opacity}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  opacity: value ?? 0.92,
                }))
              }
              step="0.05"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Base thickness px
            </span>
            <NumberInputControl
              value={draft.baseThicknessPx}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  baseThicknessPx: value ?? 10,
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Thickness variation
            </span>
            <NumberInputControl
              value={draft.thicknessVariationPx}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  thicknessVariationPx: value ?? 5,
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Length variation
            </span>
            <NumberInputControl
              value={draft.lengthVariation}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  lengthVariation: value ?? 0.18,
                }))
              }
              step="0.01"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Overscan px
            </span>
            <NumberInputControl
              value={draft.overscanPx}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  overscanPx: value ?? 48,
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Seed
            </span>
            <NumberInputControl
              value={typeof draft.seed === "number" ? draft.seed : undefined}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  seed: value ?? null,
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Min visible ms
            </span>
            <NumberInputControl
              value={draft.animation.minVisibleMs}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  animation: {
                    ...current.animation,
                    minVisibleMs: value ?? 90,
                  },
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Max visible ms
            </span>
            <NumberInputControl
              value={draft.animation.maxVisibleMs}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  animation: {
                    ...current.animation,
                    maxVisibleMs: value ?? 280,
                  },
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Min hidden ms
            </span>
            <NumberInputControl
              value={draft.animation.minHiddenMs}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  animation: {
                    ...current.animation,
                    minHiddenMs: value ?? 50,
                  },
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Max hidden ms
            </span>
            <NumberInputControl
              value={draft.animation.maxHiddenMs}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  animation: {
                    ...current.animation,
                    maxHiddenMs: value ?? 200,
                  },
                }))
              }
              step="1"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Opacity jitter
            </span>
            <NumberInputControl
              value={draft.animation.opacityJitter}
              onChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  animation: {
                    ...current.animation,
                    opacityJitter: value ?? 0.18,
                  },
                }))
              }
              step="0.01"
            />
          </label>
        </div>
      </div>
    </Panel>
  );
}
