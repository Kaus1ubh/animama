import { useEffect, useMemo, useState } from "react";

import { useElementSize } from "@/hooks/useElementSize";
import {
  anchoredViewportCover,
  type ViewportRect,
} from "@/lib/scene-vfx/layerGeometry";
import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneVFXBackgroundLayersEffect } from "./SceneVFXBackgroundLayersEffect";

/** Track the anchor's window rect as the canvas or the window resizes. */
function useAnchoredCover(anchor: HTMLElement | null): ViewportRect | null {
  const [cover, setCover] = useState<ViewportRect | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setCover(
        anchoredViewportCover(
          {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor]);
  return cover;
}

/**
 * Extend a page preview's background beneath its floating panels without
 * changing the avatar canvas, camera framing, or canvas-local focus targets.
 * The fixed surface escapes the preview's clipping ancestors; it stays in
 * the underlay stacking context, below the canvas and application chrome.
 *
 * The surface is centred on the canvas (and oversized to still cover the
 * window), so centre-based layers line up with the Avatar when the canvas
 * sits off-centre beside page panels.
 */
export function SceneVFXViewportBackground({
  runtimeEntry,
}: {
  runtimeEntry: SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry>;
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const cover = useAnchoredCover(anchor);
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
    <>
      {/* Occupies the canvas box so the surface can centre on it. */}
      <div ref={setAnchor} className="absolute inset-0" aria-hidden="true" />
      <div
        ref={setElement}
        className="pointer-events-none fixed overflow-hidden"
        style={
          cover
            ? {
                left: cover.left,
                top: cover.top,
                width: cover.width,
                height: cover.height,
              }
            : { inset: 0 }
        }
        data-scene-background-scope="viewport"
        aria-hidden="true"
      >
        <CanvasViewportProvider value={viewport}>
          <SceneVFXBackgroundLayersEffect runtimeEntry={runtimeEntry} />
        </CanvasViewportProvider>
      </div>
    </>
  );
}
