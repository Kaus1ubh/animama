"use client";

import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import { SceneVFXUnderlayLayers } from "./SceneVFXLayers";

type SceneVFXUnderlayHostProps = {
  allowBackgroundLayers?: boolean;
};

export function SceneVFXUnderlayHost({
  allowBackgroundLayers = true,
}: SceneVFXUnderlayHostProps) {
  const activeByKind = useSceneVFXStore((state) => state.activeByKind);
  return (
    <SceneVFXUnderlayLayers
      activeByKind={activeByKind}
      allowBackgroundLayers={allowBackgroundLayers}
    />
  );
}
