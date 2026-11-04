import type { CSSProperties } from "react";

import { directionVector } from "@/lib/scene-vfx/layerGeometry";
import type { SceneBackgroundTileLayer } from "@/lib/scene-vfx/types";

/**
 * C2: one image repeated over the view, drifting one tile per cycle in a
 * marquee direction (`scene-vfx-tile-drift`).
 */
export function SceneVFXTileLayer({
  layer,
}: {
  layer: SceneBackgroundTileLayer | undefined;
}) {
  if (!layer?.enabled || layer.opacity <= 0 || layer.size <= 0) return null;
  const vector = directionVector(layer.direction);
  const moving = layer.speedPxPerSec > 0 && (vector.x !== 0 || vector.y !== 0);
  // One cycle moves the pattern by one tile along each moving axis.
  const shift = {
    x: Math.sign(vector.x) * layer.size,
    y: Math.sign(vector.y) * layer.size,
  };
  const cycleSec = Math.hypot(shift.x, shift.y) / layer.speedPxPerSec;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-repeat"
      data-scene-vfx-layer="tile"
      style={
        {
          backgroundImage: `url("${layer.src}")`,
          backgroundSize: `${layer.size}px ${layer.size}px`,
          opacity: layer.opacity,
          ...(moving
            ? {
                "--scene-vfx-tile-x": `${shift.x}px`,
                "--scene-vfx-tile-y": `${shift.y}px`,
                animation: `scene-vfx-tile-drift ${cycleSec}s linear infinite`,
              }
            : {}),
        } as CSSProperties
      }
    />
  );
}
