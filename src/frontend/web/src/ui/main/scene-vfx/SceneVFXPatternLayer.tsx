"use client";

import {
  getSceneBackgroundPatternDataUrl,
  getSceneBackgroundPatternTileSize,
} from "@/lib/scene-vfx/patterns";
import type { SceneBackgroundPatternLayer } from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";

type SceneVFXPatternLayerProps = {
  className?: string;
  layer: SceneBackgroundPatternLayer;
};

export function SceneVFXPatternLayer({
  className,
  layer,
}: SceneVFXPatternLayerProps) {
  if (!layer.enabled || layer.pattern === "none" || layer.opacity <= 0) {
    return null;
  }

  const patternUrl = getSceneBackgroundPatternDataUrl({
    pattern: layer.pattern,
    color: layer.color,
    size: layer.size,
    spacing: layer.spacing,
  });

  if (!patternUrl) {
    return null;
  }

  const tileSize = getSceneBackgroundPatternTileSize({
    size: layer.size,
    spacing: layer.spacing,
  });

  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0 bg-repeat", className)}
      data-scene-vfx-layer="pattern"
      style={{
        backgroundImage: `url("${patternUrl}")`,
        backgroundSize: `${tileSize}px ${tileSize}px`,
        opacity: layer.opacity,
      }}
    />
  );
}
