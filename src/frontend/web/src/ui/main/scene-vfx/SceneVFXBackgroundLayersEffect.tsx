"use client";

import type { CSSProperties } from "react";

import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { SceneVFXMarqueeLayer } from "./SceneVFXMarqueeLayer";
import { SceneVFXPatternLayer } from "./SceneVFXPatternLayer";
import { SceneVFXSolidLayer } from "./SceneVFXSolidLayer";

type SceneVFXBackgroundLayersEffectProps = {
  className?: string;
  runtimeEntry: SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry>;
  style?: CSSProperties;
};

export function SceneVFXBackgroundLayersEffect({
  className,
  runtimeEntry,
  style,
}: SceneVFXBackgroundLayersEffectProps) {
  const { entry } = runtimeEntry;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      data-scene-vfx-id={runtimeEntry.runtimeId ?? entry.id}
      data-scene-vfx-kind={entry.kind}
      style={style}
    >
      <SceneVFXSolidLayer layer={entry.solid} />
      <SceneVFXPatternLayer layer={entry.pattern} />
      <SceneVFXMarqueeLayer layer={entry.marquee} />
    </div>
  );
}
