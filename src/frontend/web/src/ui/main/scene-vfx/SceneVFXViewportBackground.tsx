import { useMemo, useState } from "react";

import { useElementSize } from "@/hooks/useElementSize";
import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneVFXBackgroundLayersEffect } from "./SceneVFXBackgroundLayersEffect";

/**
 * Extend a page preview's background beneath its floating panels without
 * changing the avatar canvas, camera framing, or canvas-local focus targets.
 * The fixed surface escapes the preview's clipping ancestors; it stays in
 * the underlay stacking context, below the canvas and application chrome.
 */
export function SceneVFXViewportBackground({
  runtimeEntry,
}: {
  runtimeEntry: SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry>;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const { width, height } = useElementSize(element);
  const viewport = useMemo(
    () => ({
      width,
      height,
      aspectRatio: height > 0 ? width / height : 16 / 9,
      hasSize: width > 0 && height > 0,
    }),
    [width, height],
  );

  return (
    <div
      ref={setElement}
      className="pointer-events-none fixed inset-0 overflow-hidden"
      data-scene-background-scope="viewport"
      aria-hidden="true"
    >
      <CanvasViewportProvider value={viewport}>
        <SceneVFXBackgroundLayersEffect runtimeEntry={runtimeEntry} />
      </CanvasViewportProvider>
    </div>
  );
}
