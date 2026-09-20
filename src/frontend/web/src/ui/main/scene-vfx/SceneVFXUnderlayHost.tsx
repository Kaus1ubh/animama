"use client";

import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import { SceneVFXUnderlayLayers } from "./SceneVFXLayers";

type SceneVFXUnderlayHostProps = {
  allowBackgroundLayers?: boolean;
  backgroundScope?: "canvas" | "viewport";
};

export function SceneVFXUnderlayHost({
  allowBackgroundLayers = true,
  backgroundScope = "canvas",
}: SceneVFXUnderlayHostProps) {
  const activeByKind = useSceneVFXStore((state) => state.activeByKind);
  return (
    <SceneVFXUnderlayLayers
      activeByKind={activeByKind}
      allowBackgroundLayers={allowBackgroundLayers}
      backgroundScope={backgroundScope}
    />
  );
}
