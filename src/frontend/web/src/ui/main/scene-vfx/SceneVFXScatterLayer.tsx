"use client";

import { useMemo, type CSSProperties } from "react";

import { scatterPlacements } from "@/lib/scene-vfx/layerGeometry";
import type { ResolvedSceneBackgroundScatterLayer } from "@/lib/scene-vfx/types";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";

/**
 * C4 and C5: items scattered over the view with per-item size, rotation and
 * opacity, each drifting (`scene-vfx-drift`), spinning (`scene-vfx-spin`) and
 * pulsing (`scene-vfx-twinkle`, `-pop`, `-flicker`) on nested elements so
 * the transforms combine.
 */
export function SceneVFXScatterLayer({
  layer,
}: {
  layer: ResolvedSceneBackgroundScatterLayer;
}) {
  const viewport = useCanvasViewport();
  const placements = useMemo(
    () => scatterPlacements(layer, viewport.width, viewport.height),
    [layer, viewport.width, viewport.height],
  );
  if (!layer.enabled || !viewport.hasSize || placements.length === 0)
    return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-scene-vfx-layer="scatter"
    >
      {placements.map((placement) => (
        <div
          key={placement.key}
          className="absolute"
          style={
            {
              left: placement.x,
              top: placement.y,
              width: placement.size,
              height: placement.size,
              ...(placement.drift
                ? {
                    "--scene-vfx-drift-x": `${placement.drift.x}px`,
                    "--scene-vfx-drift-y": `${placement.drift.y}px`,
                    animation: `scene-vfx-drift ${placement.drift.durationSec}s linear ${placement.drift.delaySec}s infinite`,
                  }
                : {}),
            } as CSSProperties
          }
        >
          <div
            className="h-full w-full"
            style={{
              animation: placement.spin
                ? `scene-vfx-spin ${placement.spin.durationSec}s linear ${placement.spin.delaySec}s infinite ${placement.spin.reverse ? "reverse" : "normal"}`
                : undefined,
            }}
          >
            <div
              className="h-full w-full"
              style={{
                animation: placement.pulse
                  ? `scene-vfx-${placement.pulse.name} ${placement.pulse.durationSec}s ease-in-out ${placement.pulse.delaySec}s infinite`
                  : undefined,
              }}
            >
              <div
                className="h-full w-full"
                data-scene-vfx-item-id={placement.item.id}
                style={{
                  backgroundImage: `url("${placement.item.src}")`,
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "contain",
                  opacity: placement.opacity,
                  transform:
                    placement.rotationDeg !== 0
                      ? `rotate(${placement.rotationDeg}deg)`
                      : undefined,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
