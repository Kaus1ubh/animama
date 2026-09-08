"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  areResolvedTargetsSimilar,
  buildFocusLinePolygons,
  resolveManualFocusTarget,
  type SceneFocusResolvedTarget,
} from "@/lib/scene-vfx/focus-lines";
import type {
  ResolvedSceneFocusLinesVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { useCanvasViewport } from "@/ui/main/canvas/CanvasViewportContext";
import { useSceneRuntime } from "@/ui/main/canvas/SceneRuntimeContext";

type SceneVFXFocusLinesEffectProps = {
  className?: string;
  runtimeEntry: SceneVFXRuntimeEntry<ResolvedSceneFocusLinesVFXEntry>;
};

const FOCUS_LINES_TARGET_SAMPLE_INTERVAL_MS = 1000 / 2;

type FocusLinePolygonStyle = CSSProperties & {
  "--scene-vfx-focus-line-opacity"?: number;
};

export function SceneVFXFocusLinesEffect({
  className,
  runtimeEntry,
}: SceneVFXFocusLinesEffectProps) {
  const canvasViewport = useCanvasViewport();
  const { avatar } = useSceneRuntime();
  const { entry } = runtimeEntry;
  const [avatarResolvedTarget, setAvatarResolvedTarget] =
    useState<SceneFocusResolvedTarget | null>(null);
  const shouldTrackAvatarTarget =
    canvasViewport.hasSize && entry.target.kind === "avatar_face";

  const manualResolvedTarget = useMemo(() => {
    if (!canvasViewport.hasSize || entry.target.kind !== "manual_box") {
      return null;
    }

    return resolveManualFocusTarget({
      rect: entry.target.rect,
      viewport: canvasViewport,
    });
  }, [canvasViewport, entry.target]);

  useEffect(() => {
    if (!shouldTrackAvatarTarget || entry.target.kind !== "avatar_face") {
      return;
    }

    const target = entry.target;
    let isCancelled = false;

    const updateTarget = () => {
      const nextTarget =
        avatar?.resolveFocusLinesFaceTarget(canvasViewport, {
          paddingXPx: target.paddingXPx,
          paddingYPx: target.paddingYPx,
        }) ?? null;
      if (isCancelled) {
        return;
      }

      setAvatarResolvedTarget((current) =>
        areResolvedTargetsSimilar(current, nextTarget) ? current : nextTarget,
      );
    };

    updateTarget();
    const intervalId = window.setInterval(
      updateTarget,
      FOCUS_LINES_TARGET_SAMPLE_INTERVAL_MS,
    );

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [avatar, canvasViewport, entry.target, shouldTrackAvatarTarget]);

  const resolvedTarget =
    entry.target.kind === "manual_box"
      ? manualResolvedTarget
      : canvasViewport.hasSize
        ? avatarResolvedTarget
        : null;

  const polygons = useMemo(() => {
    if (!canvasViewport.hasSize || !resolvedTarget) {
      return [];
    }

    return buildFocusLinePolygons({
      animation: entry.animation,
      baseThicknessPx: entry.baseThicknessPx,
      lengthVariation: entry.lengthVariation,
      lineCount: entry.lineCount,
      opacity: entry.opacity,
      overscanPx: entry.overscanPx,
      seed: entry.seed,
      target: resolvedTarget,
      thicknessVariationPx: entry.thicknessVariationPx,
      viewport: canvasViewport,
    });
  }, [canvasViewport, entry, resolvedTarget]);

  if (!canvasViewport.hasSize || !resolvedTarget || polygons.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      data-scene-vfx-id={runtimeEntry.runtimeId ?? entry.id}
      data-scene-vfx-kind={entry.kind}
      data-scene-vfx-render-placement={entry.renderPlacement}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-visible"
        preserveAspectRatio="none"
        viewBox={`0 0 ${canvasViewport.width} ${canvasViewport.height}`}
      >
        {polygons.map((polygon) => (
          <polygon
            key={polygon.id}
            fill={entry.color}
            points={polygon.points}
            style={
              {
                opacity: 0,
                animationName: "scene-vfx-focus-lines-flicker",
                animationDuration: `${polygon.animationDurationMs}ms`,
                animationDelay: `${polygon.animationDelayMs}ms`,
                animationIterationCount: "infinite",
                animationTimingFunction: "linear",
                "--scene-vfx-focus-line-opacity": polygon.maxOpacity,
              } as FocusLinePolygonStyle
            }
          />
        ))}
      </svg>
    </div>
  );
}
