"use client";

import type {
  AvatarVFXAppliedEffectSnapshot,
  AvatarVFXApplyMode,
  AvatarVFXAssetShape,
  AvatarVFXCatalogEntry,
  AvatarVFXHoverPlacement,
  AvatarVFXRotationDirection,
  AvatarVFXSide,
  AvatarVFXTargetBindingSnapshot,
  AvatarVFXTargetRole,
  AvatarVFXTexturePivot,
  VRMEditorSession,
} from "@/lib/avatar";
import {
  getAvatarVFXApplyMode,
  getAvatarVFXTargetRole,
  isBoxHoverVFXEntry,
  isEyeHoverVFXEntry,
  isFaceAnchoredVFXEntry,
  isHoverVFXEntry,
  isMouthHoverVFXEntry,
  isTextureVFXEntry,
} from "@/lib/avatar";
import { AppImage } from "@/platform/image/AppImage";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import {
  NumberInputControl,
  SelectControl,
  TextInputControl,
} from "../controls";
import { formatMaybeText } from "../formatting";
import {
  bindingSupportsCatalogApplyDefaults,
  bindingSupportsCatalogEffect,
  cloneCatalogEffectEntry,
  formatAnimationConfigSummary,
  formatEffectPlacementSummary,
  formatTransformSummary,
  getCatalogEffectDraftIssue,
  vfxApplyModes,
  vfxAssetShapes,
  vfxHoverPlacements,
  vfxRotationDirections,
  vfxSides,
  vfxTargetRoles,
  vfxTextureLayouts,
  vfxTexturePivots,
} from "./helpers";
import type { VFXCatalogDraftController } from "./use-vfx-catalog-drafts";

export function CatalogEffectCard({
  effect,
  session,
  drafts,
  targetBindings,
  activeEffectsByEffectId,
  bindingByKey,
  playSfxCue,
}: {
  effect: AvatarVFXCatalogEntry;
  session: VRMEditorSession | null;
  drafts: VFXCatalogDraftController;
  targetBindings: AvatarVFXTargetBindingSnapshot[];
  activeEffectsByEffectId: Map<string, AvatarVFXAppliedEffectSnapshot[]>;
  bindingByKey: Map<string, AvatarVFXTargetBindingSnapshot>;
  playSfxCue: (cue: string) => void;
}) {
  const draftEffect = drafts.getEffectDraft(effect);
  const placementSummary = formatEffectPlacementSummary(draftEffect);
  const transformSummary = formatTransformSummary(draftEffect);
  const animationConfigSummary = formatAnimationConfigSummary({
    config: draftEffect.animationConfig,
  });
  const targetRole = getAvatarVFXTargetRole(draftEffect);
  const defaultApplyMode = getAvatarVFXApplyMode(draftEffect);
  const compatibleBindings = targetBindings.filter((binding) =>
    bindingSupportsCatalogEffect(binding, draftEffect),
  );
  const draftIssue = getCatalogEffectDraftIssue(draftEffect);
  const applyBinding =
    compatibleBindings.find((binding) =>
      bindingSupportsCatalogApplyDefaults(binding, draftEffect),
    ) ?? null;
  const activeEffectsForEffect =
    activeEffectsByEffectId.get(draftEffect.id) ?? [];
  const activeBindingLabels = activeEffectsForEffect
    .map(
      (activeEffect) =>
        bindingByKey.get(activeEffect.bindingKey)?.materialName ??
        activeEffect.materialName ??
        activeEffect.bindingKey,
    )
    .filter((value): value is string => Boolean(value));
  const canApply = Boolean(
    session && compatibleBindings.length > 0 && !draftIssue,
  );
  const canRemove = Boolean(session && activeEffectsForEffect.length > 0);

  const statusLine =
    activeEffectsForEffect.length > 0
      ? `Active on ${activeBindingLabels.join(", ")}`
      : draftIssue
        ? draftIssue
        : applyBinding
          ? `Ready on ${formatMaybeText(applyBinding.materialName)}`
          : compatibleBindings.length === 0
            ? `No live ${targetRole} binding detected`
            : defaultApplyMode === "overlay"
              ? "No overlay-capable texture slot on compatible binding"
              : "No compatible binding available";

  const handleApply = () => {
    if (!session) return;
    const shouldPlayApplySound = activeEffectsForEffect.length === 0;
    const draftEffectClone = cloneCatalogEffectEntry(draftEffect);

    void (async () => {
      if (isHoverVFXEntry(draftEffectClone)) {
        await session.applyHoverVFX(draftEffectClone.id, draftEffectClone);
      } else if (isFaceAnchoredVFXEntry(draftEffectClone)) {
        await session.applyFaceAnchoredVFX(
          draftEffectClone.id,
          draftEffectClone,
        );
      } else {
        await session.applyTextureVFX(
          draftEffectClone.id,
          draftEffectClone.applyMode,
          draftEffectClone,
        );
      }

      if (shouldPlayApplySound && draftEffectClone.sound?.onApply) {
        playSfxCue(draftEffectClone.sound.onApply);
      }
    })();
  };

  const handleRemove = () => {
    if (!session) return;
    activeEffectsForEffect.forEach((activeEffect) => {
      session.removeVFXEffect(activeEffect.appliedEffectId);
    });
  };

  return (
    <div
      key={effect.id}
      className="border-border/60 bg-background/70 flex items-start gap-3 rounded-lg border p-3"
    >
      <div className="border-border/60 bg-background flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
        <AppImage
          src={draftEffect.assetPath}
          alt={draftEffect.label}
          width={64}
          height={64}
          unoptimized
          className="h-full w-full object-contain"
        />
      </div>
      <div className="min-w-0">
        <div className="text-foreground font-medium">{draftEffect.label}</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {targetRole} • {draftEffect.kind}
        </div>
        {placementSummary ? (
          <div className="text-muted-foreground mt-1 text-xs">
            {placementSummary}
          </div>
        ) : null}
        {transformSummary ? (
          <div className="text-muted-foreground mt-1 text-xs">
            {transformSummary}
          </div>
        ) : null}
        {animationConfigSummary ? (
          <div className="text-muted-foreground mt-1 text-xs">
            {animationConfigSummary}
          </div>
        ) : null}
        <div className="text-muted-foreground mt-1 text-xs">{statusLine}</div>
        <details className="border-border/60 bg-background/60 mt-3 rounded-md border px-3 py-2">
          <summary className="text-foreground cursor-pointer text-xs font-medium">
            Adjust
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Asset path
              </span>
              <TextInputControl
                value={draftEffect.assetPath}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    assetPath: value,
                  }))
                }
              />
            </label>
            {isTextureVFXEntry(draftEffect) ? (
              <>
                <label className="space-y-1">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    Target role
                  </span>
                  <SelectControl
                    value={draftEffect.targetRole}
                    onChange={(value) =>
                      drafts.setEffectDraft(draftEffect.id, (current) =>
                        isTextureVFXEntry(current)
                          ? {
                              ...current,
                              targetRole: value as AvatarVFXTargetRole,
                            }
                          : current,
                      )
                    }
                  >
                    {vfxTargetRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </SelectControl>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    Asset shape
                  </span>
                  <SelectControl
                    value={draftEffect.assetShape}
                    onChange={(value) =>
                      drafts.setEffectDraft(draftEffect.id, (current) =>
                        isTextureVFXEntry(current)
                          ? {
                              ...current,
                              assetShape: value as AvatarVFXAssetShape,
                            }
                          : current,
                      )
                    }
                  >
                    {vfxAssetShapes.map((shape) => (
                      <option key={shape} value={shape}>
                        {shape}
                      </option>
                    ))}
                  </SelectControl>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    Apply mode
                  </span>
                  <SelectControl
                    value={draftEffect.applyMode}
                    onChange={(value) =>
                      drafts.setEffectDraft(draftEffect.id, (current) =>
                        isTextureVFXEntry(current)
                          ? {
                              ...current,
                              applyMode: value as AvatarVFXApplyMode,
                            }
                          : current,
                      )
                    }
                  >
                    {vfxApplyModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </SelectControl>
                </label>
                {draftEffect.targetRole === "eye_iris" &&
                draftEffect.assetShape === "single_eye" ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                        Side
                      </span>
                      <SelectControl
                        value={draftEffect.side ?? ""}
                        onChange={(value) =>
                          drafts.setEffectDraft(draftEffect.id, (current) =>
                            isTextureVFXEntry(current)
                              ? {
                                  ...current,
                                  side:
                                    value.length > 0
                                      ? (value as AvatarVFXSide)
                                      : undefined,
                                }
                              : current,
                          )
                        }
                      >
                        <option value="">auto pair</option>
                        {vfxSides.map((side) => (
                          <option key={side} value={side}>
                            {side}
                          </option>
                        ))}
                      </SelectControl>
                    </label>
                    <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm sm:col-span-2">
                      <Switch
                        checked={draftEffect.requiresMirror ?? false}
                        onCheckedChange={(checked) =>
                          drafts.setEffectDraft(draftEffect.id, (current) =>
                            isTextureVFXEntry(current)
                              ? {
                                  ...current,
                                  requiresMirror: checked,
                                }
                              : current,
                          )
                        }
                        aria-label={`Toggle mirrored eye texture for ${draftEffect.label}`}
                      />
                      <span>Mirror to opposite eye</span>
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
            {isFaceAnchoredVFXEntry(draftEffect) ? (
              <>
                <label className="space-y-1">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    Pivot
                  </span>
                  <SelectControl
                    value={draftEffect.pivot ?? "center"}
                    onChange={(value) =>
                      drafts.setEffectDraft(draftEffect.id, (current) =>
                        isFaceAnchoredVFXEntry(current)
                          ? {
                              ...current,
                              pivot: value as AvatarVFXTexturePivot,
                            }
                          : current,
                      )
                    }
                  >
                    {vfxTexturePivots.map((pivot) => (
                      <option key={pivot} value={pivot}>
                        {pivot}
                      </option>
                    ))}
                  </SelectControl>
                </label>
                {draftEffect.anchor !== "mouth" ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                        Texture layout
                      </span>
                      <SelectControl
                        value={draftEffect.layout}
                        onChange={(value) =>
                          drafts.setEffectDraft(draftEffect.id, (current) => {
                            if (
                              !isFaceAnchoredVFXEntry(current) ||
                              current.anchor === "mouth"
                            ) {
                              return current;
                            }
                            if (value === "span") {
                              return {
                                ...current,
                                layout: "span",
                              };
                            }
                            return {
                              ...current,
                              layout: "single",
                              side:
                                "side" in current && current.side
                                  ? current.side
                                  : "right",
                            };
                          })
                        }
                      >
                        {vfxTextureLayouts.map((layout) => (
                          <option key={layout} value={layout}>
                            {layout}
                          </option>
                        ))}
                      </SelectControl>
                    </label>
                    {draftEffect.layout === "single" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                            Side
                          </span>
                          <SelectControl
                            value={draftEffect.side}
                            onChange={(value) =>
                              drafts.setEffectDraft(
                                draftEffect.id,
                                (current) =>
                                  isFaceAnchoredVFXEntry(current) &&
                                  current.anchor !== "mouth" &&
                                  current.layout === "single"
                                    ? {
                                        ...current,
                                        side: value as AvatarVFXSide,
                                      }
                                    : current,
                              )
                            }
                          >
                            {vfxSides.map((side) => (
                              <option key={side} value={side}>
                                {side}
                              </option>
                            ))}
                          </SelectControl>
                        </label>
                        <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm sm:col-span-2">
                          <Switch
                            checked={draftEffect.requiresMirror ?? false}
                            onCheckedChange={(checked) =>
                              drafts.setEffectDraft(
                                draftEffect.id,
                                (current) =>
                                  isFaceAnchoredVFXEntry(current) &&
                                  current.anchor !== "mouth" &&
                                  current.layout === "single"
                                    ? {
                                        ...current,
                                        requiresMirror: checked,
                                      }
                                    : current,
                              )
                            }
                            aria-label={`Toggle mirrored anchored decal for ${draftEffect.label}`}
                          />
                          <span>Mirror to opposite side</span>
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {isHoverVFXEntry(draftEffect) ? (
              <>
                {isBoxHoverVFXEntry(draftEffect) ? (
                  <label className="space-y-1">
                    <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                      Hover placement
                    </span>
                    <SelectControl
                      value={draftEffect.placement}
                      onChange={(value) =>
                        drafts.setEffectDraft(draftEffect.id, (current) =>
                          isBoxHoverVFXEntry(current)
                            ? {
                                ...current,
                                placement: value as AvatarVFXHoverPlacement,
                              }
                            : current,
                        )
                      }
                    >
                      {vfxHoverPlacements.map((placement) => (
                        <option key={placement} value={placement}>
                          {placement}
                        </option>
                      ))}
                    </SelectControl>
                  </label>
                ) : isEyeHoverVFXEntry(draftEffect) ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                        Side
                      </span>
                      <SelectControl
                        value={draftEffect.side ?? ""}
                        onChange={(value) =>
                          drafts.setEffectDraft(draftEffect.id, (current) =>
                            isEyeHoverVFXEntry(current)
                              ? {
                                  ...current,
                                  side:
                                    value.length > 0
                                      ? (value as AvatarVFXSide)
                                      : undefined,
                                }
                              : current,
                          )
                        }
                      >
                        <option value="">centered</option>
                        {vfxSides.map((side) => (
                          <option key={side} value={side}>
                            {side}
                          </option>
                        ))}
                      </SelectControl>
                    </label>
                    <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm sm:col-span-2">
                      <Switch
                        checked={draftEffect.requiresMirror ?? false}
                        onCheckedChange={(checked) =>
                          drafts.setEffectDraft(draftEffect.id, (current) =>
                            isEyeHoverVFXEntry(current)
                              ? {
                                  ...current,
                                  requiresMirror: checked,
                                }
                              : current,
                          )
                        }
                        aria-label={`Toggle mirrored eye hover for ${draftEffect.label}`}
                      />
                      <span>Mirror to opposite eye</span>
                    </label>
                  </>
                ) : isMouthHoverVFXEntry(draftEffect) ? (
                  <div className="border-border/60 bg-background text-muted-foreground rounded-md border px-3 py-2 text-sm sm:col-span-2">
                    Mouth hover resolves from the cached mouth anchor and uses a
                    centered placement.
                  </div>
                ) : null}
                {isEyeHoverVFXEntry(draftEffect) ||
                isMouthHoverVFXEntry(draftEffect) ? (
                  <label className="border-border/60 bg-background text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm sm:col-span-2">
                    <Switch
                      checked={draftEffect.skinBackdrop ?? false}
                      onCheckedChange={(checked) =>
                        drafts.setEffectDraft(draftEffect.id, (current) =>
                          isEyeHoverVFXEntry(current) ||
                          isMouthHoverVFXEntry(current)
                            ? {
                                ...current,
                                skinBackdrop: checked,
                              }
                            : current,
                        )
                      }
                      aria-label={`Toggle skin backdrop for ${draftEffect.label}`}
                    />
                    <span>Sampled skin backdrop</span>
                  </label>
                ) : null}
              </>
            ) : null}
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Offset x
              </span>
              <NumberInputControl
                value={draftEffect.transform.offset.x}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      offset: {
                        ...current.transform.offset,
                        x: value ?? 0,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Offset y
              </span>
              <NumberInputControl
                value={draftEffect.transform.offset.y}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      offset: {
                        ...current.transform.offset,
                        y: value ?? 0,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Offset z
              </span>
              <NumberInputControl
                value={draftEffect.transform.offset.z}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      offset: {
                        ...current.transform.offset,
                        z: value ?? 0,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Scale x
              </span>
              <NumberInputControl
                value={draftEffect.transform.scale.x}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      scale: {
                        ...current.transform.scale,
                        x: value ?? 1,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Scale y
              </span>
              <NumberInputControl
                value={draftEffect.transform.scale.y}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      scale: {
                        ...current.transform.scale,
                        y: value ?? 1,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Scale z
              </span>
              <NumberInputControl
                value={draftEffect.transform.scale.z}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    transform: {
                      ...current.transform,
                      scale: {
                        ...current.transform.scale,
                        z: value ?? 1,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Pulse min
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.pulseScaleMin}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      pulseScaleMin: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Pulse max
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.pulseScaleMax}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      pulseScaleMax: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Pulse speed
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.pulseCyclesPerSecond}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      pulseCyclesPerSecond: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Rotation amount
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.rotationAmountTurns}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      rotationAmountTurns: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Rotation speed
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.rotationRadiansPerSecond}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      rotationRadiansPerSecond: value,
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Rotation direction
              </span>
              <SelectControl
                value={
                  draftEffect.animationConfig?.rotationDirection ??
                  "__default__"
                }
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      rotationDirection:
                        value === "__default__"
                          ? undefined
                          : (value as AvatarVFXRotationDirection),
                    },
                  }))
                }
              >
                <option value="__default__">default (counterclockwise)</option>
                {vfxRotationDirections.map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Drift x
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.driftPerSecond?.x}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      driftPerSecond: {
                        ...current.animationConfig?.driftPerSecond,
                        x: value,
                      },
                    },
                  }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Drift y
              </span>
              <NumberInputControl
                value={draftEffect.animationConfig?.driftPerSecond?.y}
                onChange={(value) =>
                  drafts.setEffectDraft(draftEffect.id, (current) => ({
                    ...current,
                    animationConfig: {
                      ...current.animationConfig,
                      driftPerSecond: {
                        ...current.animationConfig?.driftPerSecond,
                        y: value,
                      },
                    },
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => drafts.resetEffectDraft(draftEffect.id)}
            >
              Reset Draft
            </Button>
          </div>
        </details>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleApply}
            disabled={!canApply}
          >
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleRemove}
            disabled={!canRemove}
          >
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
