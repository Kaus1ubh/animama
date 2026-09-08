"use client";

import type { SceneVFXActiveByKind } from "@/lib/scene-vfx/runtime-state";
import { cn } from "@/lib/utils";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneVFXBackgroundLayersEffect } from "./SceneVFXBackgroundLayersEffect";
import { SceneVFXFocusLinesEffect } from "./SceneVFXFocusLinesEffect";

export function SceneVFXUnderlayLayers({
  activeByKind,
  allowBackgroundLayers = true,
  className,
}: {
  activeByKind: SceneVFXActiveByKind;
  allowBackgroundLayers?: boolean;
  className?: string;
}) {
  const canvasViewport = useCanvasViewport();
  const activeBackgroundLayers = allowBackgroundLayers
    ? (activeByKind.background_layers ?? null)
    : null;
  const activeFocusLines = activeByKind.focus_lines;
  const behindAvatarFocusLines =
    activeFocusLines?.entry.renderPlacement === "behind_avatar"
      ? activeFocusLines
      : null;

  if (
    !canvasViewport.hasSize ||
    (!activeBackgroundLayers && !behindAvatarFocusLines)
  ) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden",
        className,
      )}
      style={{
        width: `${canvasViewport.width}px`,
        height: `${canvasViewport.height}px`,
      }}
    >
      {activeBackgroundLayers ? (
        <SceneVFXBackgroundLayersEffect runtimeEntry={activeBackgroundLayers} />
      ) : null}
      {behindAvatarFocusLines ? (
        <SceneVFXFocusLinesEffect runtimeEntry={behindAvatarFocusLines} />
      ) : null}
    </div>
  );
}

export function SceneVFXOverlayLayers({
  activeByKind,
  className,
}: {
  activeByKind: SceneVFXActiveByKind;
  className?: string;
}) {
  const canvasViewport = useCanvasViewport();
  const activeFocusLines = activeByKind.focus_lines;
  const frontOfAvatarFocusLines =
    activeFocusLines?.entry.renderPlacement === "front_of_avatar"
      ? activeFocusLines
      : null;

  if (!canvasViewport.hasSize || !frontOfAvatarFocusLines) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      style={{
        width: `${canvasViewport.width}px`,
        height: `${canvasViewport.height}px`,
      }}
    >
      <SceneVFXFocusLinesEffect runtimeEntry={frontOfAvatarFocusLines} />
    </div>
  );
}
