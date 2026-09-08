"use client";

import { cn } from "@/lib/utils";
import type { SceneBackgroundSolidLayer } from "@/lib/scene-vfx/types";

type SceneVFXSolidLayerProps = {
  className?: string;
  layer: SceneBackgroundSolidLayer;
};

export function SceneVFXSolidLayer({
  className,
  layer,
}: SceneVFXSolidLayerProps) {
  if (!layer.enabled || layer.color.trim().length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0", className)}
      style={{ backgroundColor: layer.color }}
    />
  );
}
