import type { SceneBackgroundFlashLayer } from "@/lib/scene-vfx/types";

/**
 * C6: one fade from a colour when the Scene starts (`scene-vfx-flash`), over
 * the other background layers and behind the Avatar.
 */
export function SceneVFXFlashLayer({
  layer,
}: {
  layer: SceneBackgroundFlashLayer | undefined;
}) {
  if (!layer?.enabled || layer.durationMs <= 0) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      data-scene-vfx-layer="flash"
      style={{
        backgroundColor: layer.color,
        opacity: 0,
        animation: `scene-vfx-flash ${layer.durationMs}ms ease-out both`,
      }}
    />
  );
}
