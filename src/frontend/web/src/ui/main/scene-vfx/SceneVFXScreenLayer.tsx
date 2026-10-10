"use client";

import { useMemo } from "react";

import { linesGeometry, raysPath } from "@/lib/scene-vfx/layerGeometry";
import type {
  SceneBackgroundLinesScreen,
  SceneBackgroundRaysScreen,
  SceneBackgroundScreenLayer,
} from "@/lib/scene-vfx/types";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";

/**
 * C3: a procedural anime screen, drawn as SVG: rays radiating from a centre
 * (turning with `scene-vfx-spin`, throbbing with `scene-vfx-throb`), or lines
 * hanging from the top edge (swaying with `scene-vfx-sway`).
 */
export function SceneVFXScreenLayer({
  layer,
}: {
  layer: SceneBackgroundScreenLayer | undefined;
}) {
  const viewport = useCanvasViewport();
  if (!layer?.enabled || layer.opacity <= 0 || !viewport.hasSize) return null;
  return layer.kind === "rays" ? (
    <RaysScreen layer={layer} width={viewport.width} height={viewport.height} />
  ) : (
    <LinesScreen
      layer={layer}
      width={viewport.width}
      height={viewport.height}
    />
  );
}

function RaysScreen({
  layer,
  width,
  height,
}: {
  layer: SceneBackgroundRaysScreen;
  width: number;
  height: number;
}) {
  const path = useMemo(() => raysPath(layer), [layer]);
  // A square large enough to cover the view from any centre while turning.
  const size = 2 * Math.hypot(width, height);
  return (
    <div
      aria-hidden="true"
      className="absolute"
      data-scene-vfx-layer="rays"
      style={{
        width: size,
        height: size,
        left: layer.centerX * width - size / 2,
        top: layer.centerY * height - size / 2,
        opacity: layer.opacity,
        animation:
          layer.turnSeconds !== 0
            ? `scene-vfx-spin ${Math.abs(layer.turnSeconds)}s linear infinite ${layer.turnSeconds < 0 ? "reverse" : "normal"}`
            : undefined,
      }}
    >
      <svg
        viewBox="-1 -1 2 2"
        width="100%"
        height="100%"
        style={{
          animation:
            layer.throbPerSec > 0
              ? `scene-vfx-throb ${1 / layer.throbPerSec}s ease-in-out infinite`
              : undefined,
        }}
      >
        <path d={path} fill={layer.color} />
      </svg>
    </div>
  );
}

function LinesScreen({
  layer,
  width,
  height,
}: {
  layer: SceneBackgroundLinesScreen;
  width: number;
  height: number;
}) {
  const lines = useMemo(
    () => linesGeometry(layer, width, height),
    [layer, width, height],
  );
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0"
      data-scene-vfx-layer="lines"
      width={width}
      height={height}
      style={{
        opacity: layer.opacity,
        transformOrigin: "50% 0",
        animation:
          layer.swaySeconds > 0
            ? `scene-vfx-sway ${layer.swaySeconds}s ease-in-out infinite alternate`
            : undefined,
      }}
    >
      {lines.map((line, index) => (
        <line
          key={index}
          x1={line.x}
          y1={0}
          x2={line.x}
          y2={line.length}
          stroke={layer.color}
          strokeWidth={line.width}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
