"use client";

import { gradientCss } from "@/lib/scene-vfx/layerGeometry";
import type { SceneBackgroundGradientLayer } from "@/lib/scene-vfx/types";

/** C1: a linear or radial gradient over the solid fill. */
export function SceneVFXGradientLayer({
  layer,
}: {
  layer: SceneBackgroundGradientLayer | undefined;
}) {
  if (!layer?.enabled || layer.stops.length < 2) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      data-scene-vfx-layer="gradient"
      style={{ background: gradientCss(layer) }}
    />
  );
}
