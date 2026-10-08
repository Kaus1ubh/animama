import type { AvatarVFXAnimationState } from "./animation";
import type { AvatarVFXGuidePoint2 } from "./placement-guide-types";
import { isFaceAnchoredVFXEntry, type AvatarVFXCatalogEntry } from "./types";

export type TexturePlacement = {
  label: string;
  /** Draw the art flipped horizontally. */
  mirrorX: boolean;
  /**
   * The placement is the effect's own mirrored copy (`mirror` on a single-side
   * placement), whose horizontal offsets are mirrored too. A placement that is
   * flipped only by the model's UV layout keeps its offsets.
   */
  effectMirror?: boolean;
  rect: { x: number; y: number; width: number; height: number };
};

/** The canvas compositor and its informational footprint use this exact transform. */
export function resolveTexturePlacementTransform(
  placement: TexturePlacement,
  effect: AvatarVFXCatalogEntry,
  size: { width: number; height: number },
  animation: AvatarVFXAnimationState,
) {
  const anchored = isFaceAnchoredVFXEntry(effect);
  const staticScale = (value: number) =>
    Number.isFinite(value) ? Math.max(0.0001, Math.abs(value)) : 1;
  const scale = Math.max(0.0001, animation.scale);
  // The effect's own mirrored copy mirrors its horizontal offsets; anchored
  // decals already place (and mirror) their static offset in the rectangle.
  const mirrorSign = placement.effectMirror ? -1 : 1;
  const staticOffsetX = anchored ? 0 : effect.transform.offset.x * mirrorSign;
  return {
    x:
      placement.rect.x +
      placement.rect.width * 0.5 +
      (staticOffsetX + animation.driftX + animation.offsetX * mirrorSign) *
        Math.max(1, size.width),
    y:
      placement.rect.y +
      placement.rect.height * 0.5 +
      ((anchored ? 0 : effect.transform.offset.y) +
        animation.driftY +
        animation.offsetY) *
        Math.max(1, size.height),
    rotation: effect.transform.rotation.z + animation.rotationRadians,
    scaleX:
      (placement.mirrorX ? -1 : 1) *
      (anchored ? 1 : staticScale(effect.transform.scale.x)) *
      scale,
    scaleY: (anchored ? 1 : staticScale(effect.transform.scale.y)) * scale,
  };
}

/** Map a point in image-local pixels through the current canvas drawing transform. */
export function transformTexturePlacementPoint(
  point: AvatarVFXGuidePoint2,
  transform: ReturnType<typeof resolveTexturePlacementTransform>,
  size: { width: number; height: number },
): AvatarVFXGuidePoint2 {
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: (transform.x + x * cos - y * sin) / size.width,
    y: (transform.y + x * sin + y * cos) / size.height,
  };
}

export function rectangleGuidePoints(
  rect: TexturePlacement["rect"],
): AvatarVFXGuidePoint2[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}
