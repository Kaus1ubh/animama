"use client";

import type {
  AvatarVFXAnimationConfig,
  AvatarVFXApplyMode,
  AvatarVFXAssetShape,
  AvatarVFXCatalogEntry,
  AvatarVFXHoverPlacement,
  AvatarVFXResolvedAnimationConfig,
  AvatarVFXRotationDirection,
  AvatarVFXSide,
  AvatarVFXTargetBindingSnapshot,
  AvatarVFXTargetRole,
  AvatarVFXTextureLayout,
  AvatarVFXTexturePivot,
} from "@/lib/avatar";
import {
  getAvatarVFXApplyMode,
  getAvatarVFXTargetRole,
  isBoxHoverVFXEntry,
  isEyeHoverVFXEntry,
  isFaceAnchoredVFXEntry,
  isMouthHoverVFXEntry,
  isTextureVFXEntry,
} from "@/lib/avatar";
import { resolveAvatarVFXAnimationConfig } from "@/lib/avatar/vfx/animation";
import {
  hasCustomTransformOffset,
  hasCustomTransformScale,
} from "../formatting";

export const vfxApplyModes: AvatarVFXApplyMode[] = ["replace", "overlay"];
export const vfxTargetRoles: AvatarVFXTargetRole[] = [
  "eye_iris",
  "eye_highlight",
  "eyeline",
  "eyelash",
  "face_skin",
];
export const vfxAssetShapes: AvatarVFXAssetShape[] = [
  "single_eye",
  "double_eye",
  "full_face",
];
export const vfxTextureLayouts: AvatarVFXTextureLayout[] = ["single", "span"];
export const vfxTexturePivots: AvatarVFXTexturePivot[] = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
export const vfxSides: AvatarVFXSide[] = ["left", "right"];
export const vfxRotationDirections: AvatarVFXRotationDirection[] = [
  "counterclockwise",
  "clockwise",
];
export const vfxHoverPlacements: AvatarVFXHoverPlacement[] = [
  "forehead-left",
  "forehead-middle",
  "forehead-right",
  "top-left",
  "top-middle",
  "top-right",
  "top-edge-left-corner",
  "top-edge-left",
  "top-edge-middle",
  "top-edge-right",
  "top-edge-right-corner",
];

export function formatEffectPlacementSummary(
  effect: AvatarVFXCatalogEntry,
): string | null {
  if (isFaceAnchoredVFXEntry(effect)) {
    const parts = [
      "texture",
      "anchored_decal",
      effect.anchor,
      effect.anchor === "mouth" ? "single" : effect.layout,
    ];
    if ("side" in effect && effect.side) {
      parts.push(effect.side);
    }
    if ("requiresMirror" in effect && effect.requiresMirror) {
      parts.push("mirrored");
    }
    if (effect.pivot) {
      parts.push(`pivot ${effect.pivot}`);
    }
    return parts.join(" • ");
  }
  if (isEyeHoverVFXEntry(effect)) {
    const sideLabel = effect.side ? ` • ${effect.side}` : "";
    const summary = effect.requiresMirror
      ? `hover_plane • eye_hover${sideLabel} • mirrored pair`
      : effect.side
        ? `hover_plane • eye_hover${sideLabel} • single`
        : "hover_plane • eye_hover • centered pair";
    return effect.skinBackdrop ? `${summary} • skin backdrop` : summary;
  }
  if (isMouthHoverVFXEntry(effect)) {
    return effect.skinBackdrop
      ? "hover_plane • mouth_hover • centered • skin backdrop"
      : "hover_plane • mouth_hover • centered";
  }
  if (isBoxHoverVFXEntry(effect)) {
    return `hover_plane • box_hover • ${effect.placement}`;
  }
  if (isTextureVFXEntry(effect)) {
    const parts = [
      "texture",
      getAvatarVFXTargetRole(effect),
      effect.assetShape,
      effect.applyMode,
    ];
    if (effect.side) {
      parts.push(effect.side);
    }
    if (effect.requiresMirror) {
      parts.push("mirrored");
    }
    return parts.join(" • ");
  }
  return null;
}

export function formatTransformSummary(
  effect: AvatarVFXCatalogEntry,
): string | null {
  const parts: string[] = [];
  if (hasCustomTransformOffset(effect)) {
    const { offset } = effect.transform;
    parts.push(
      `offset ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}, ${offset.z.toFixed(3)}`,
    );
  }
  if (hasCustomTransformScale(effect)) {
    const { scale } = effect.transform;
    parts.push(
      `scale ${scale.x.toFixed(3)}, ${scale.y.toFixed(3)}, ${scale.z.toFixed(3)}`,
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" • ");
}

export function hasCustomAnimationConfig(
  config:
    | AvatarVFXAnimationConfig
    | AvatarVFXResolvedAnimationConfig
    | null
    | undefined,
): boolean {
  if (!config) return false;
  if ("pulseEnabled" in config) {
    return Boolean(
      config.pulseEnabled || config.spinEnabled || config.driftEnabled,
    );
  }
  return Boolean(
    typeof config.pulseScaleMin === "number" ||
    typeof config.pulseScaleMax === "number" ||
    typeof config.pulseCyclesPerSecond === "number" ||
    typeof config.rotationAmountTurns === "number" ||
    typeof config.rotationRadiansPerSecond === "number" ||
    typeof config.rotationDirection === "string" ||
    typeof config.driftPerSecond?.x === "number" ||
    typeof config.driftPerSecond?.y === "number",
  );
}

export function formatAnimationConfigSummary(args: {
  config:
    | AvatarVFXAnimationConfig
    | AvatarVFXResolvedAnimationConfig
    | null
    | undefined;
}): string | null {
  const { config } = args;
  if (!hasCustomAnimationConfig(config)) {
    return null;
  }

  const resolved = resolveAvatarVFXAnimationConfig(config);
  const parts: string[] = [];
  if (resolved.pulseEnabled) {
    parts.push(
      `pulse ${resolved.pulseScaleMin.toFixed(2)}-${resolved.pulseScaleMax.toFixed(2)} @ ${resolved.pulseCyclesPerSecond.toFixed(2)}/s`,
    );
  }
  if (resolved.spinEnabled) {
    parts.push(
      `spin ${resolved.rotationAmountTurns.toFixed(2)} turn @ ${resolved.rotationRadiansPerSecond.toFixed(2)} rad/s ${resolved.rotationDirection === "clockwise" ? "cw" : "ccw"}`,
    );
  }
  if (resolved.driftEnabled) {
    parts.push(
      `drift ${resolved.driftPerSecond.x.toFixed(2)}, ${resolved.driftPerSecond.y.toFixed(2)}/s`,
    );
  }
  return parts.length > 0 ? `cfg ${parts.join(" • ")}` : null;
}

export function cloneCatalogEffectEntry<T extends AvatarVFXCatalogEntry>(
  effect: T,
): T {
  return {
    ...effect,
    sound: effect.sound ? { ...effect.sound } : undefined,
    transform: {
      offset: { ...effect.transform.offset },
      scale: { ...effect.transform.scale },
      rotation: { ...effect.transform.rotation },
    },
    animationConfig: effect.animationConfig
      ? {
          ...effect.animationConfig,
          driftPerSecond: effect.animationConfig.driftPerSecond
            ? { ...effect.animationConfig.driftPerSecond }
            : undefined,
        }
      : undefined,
  } as T;
}

export function bindingSupportsCatalogEffect(
  binding: AvatarVFXTargetBindingSnapshot,
  effect: AvatarVFXCatalogEntry,
): boolean {
  return binding.targetRole === getAvatarVFXTargetRole(effect);
}

export function bindingSupportsCatalogApplyDefaults(
  binding: AvatarVFXTargetBindingSnapshot,
  effect: AvatarVFXCatalogEntry,
): boolean {
  const applyMode = getAvatarVFXApplyMode(effect);
  if (applyMode !== "overlay") return true;
  return binding.textureSlots.some((slot) => slot.canOverlay);
}

export function getCatalogEffectDraftIssue(
  effect: AvatarVFXCatalogEntry,
): string | null {
  if (effect.assetPath.trim().length === 0) {
    return "Asset path is required.";
  }
  if (isFaceAnchoredVFXEntry(effect)) {
    if (
      effect.anchor !== "mouth" &&
      effect.layout === "single" &&
      !effect.side
    ) {
      return "Single anchored bilateral decals require a side.";
    }
    return null;
  }
  if (isEyeHoverVFXEntry(effect)) {
    return null;
  }
  if (isMouthHoverVFXEntry(effect)) {
    return null;
  }
  if (isBoxHoverVFXEntry(effect)) {
    return effect.placement ? null : "Box hover effects require a placement.";
  }
  return null;
}
