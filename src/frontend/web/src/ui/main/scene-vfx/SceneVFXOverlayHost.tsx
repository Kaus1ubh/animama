"use client";

import { cn } from "@/lib/utils";
import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import { SceneVFXOverlayLayers } from "./SceneVFXLayers";

type SceneVFXOverlayHostProps = {
  className?: string;
};

export function SceneVFXOverlayHost({ className }: SceneVFXOverlayHostProps) {
  const activeByKind = useSceneVFXStore((state) => state.activeByKind);
  const underlayCoverUiOverlaysActive = useSceneVFXStore(
    (state) => state.underlayCoverUiOverlaysActive,
  );
  const overlayCoverUiOverlaysActive = useSceneVFXStore(
    (state) => state.overlayCoverUiOverlaysActive,
  );

  return (
    <SceneVFXOverlayLayers
      activeByKind={activeByKind}
      className={cn(
        underlayCoverUiOverlaysActive
          ? "z-[41]"
          : overlayCoverUiOverlaysActive
            ? "z-30"
            : "z-10",
        className,
      )}
    />
  );
}
