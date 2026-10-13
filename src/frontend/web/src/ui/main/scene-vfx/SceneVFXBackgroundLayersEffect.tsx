"use client";

import type { CSSProperties } from "react";

import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { SceneVFXFlashLayer } from "./SceneVFXFlashLayer";
import { SceneVFXGradientLayer } from "./SceneVFXGradientLayer";
import { SceneVFXMarqueeLayer } from "./SceneVFXMarqueeLayer";
import { SceneVFXPatternLayer } from "./SceneVFXPatternLayer";
import { SceneVFXScatterLayers } from "./SceneVFXScatterLayer";
import { SceneVFXScreenLayer } from "./SceneVFXScreenLayer";
import { SceneVFXSolidLayer } from "./SceneVFXSolidLayer";
import { SceneVFXTileLayer } from "./SceneVFXTileLayer";

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
      {/* Back to front; the optional layers (C1–C6) are off when absent. */}
      <SceneVFXSolidLayer layer={entry.solid} />
      <SceneVFXGradientLayer layer={entry.gradient} />
      <SceneVFXPatternLayer layer={entry.pattern} />
      <SceneVFXTileLayer layer={entry.tile} />
      <SceneVFXScreenLayer layer={entry.screen} />
      <SceneVFXMarqueeLayer layer={entry.marquee} />
      <SceneVFXScatterLayers layers={entry.scatters} />
      {/* A new start remounts the flash, so its one-shot fade plays again. */}
      <SceneVFXFlashLayer
        key={`${runtimeEntry.runtimeId ?? entry.id}:${runtimeEntry.startedAtMs}`}
        layer={entry.flash}
      />
    </div>
  );
}
