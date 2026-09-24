import { useFrame } from "@react-three/fiber";
import type { RefObject } from "react";
import type { Avatar } from "@/lib/avatar";
import type { AvatarVFXCatalogEntry } from "@/lib/avatar/vfx/types";
import { drawPlacementGuides } from "./placementGuideCanvas";

/** Draw after the preview actor's update, using its applied transforms and live camera. */
export function AvatarEffectGuideRenderer({
  avatar,
  effect,
  appliedId,
  canvasRef,
}: {
  avatar: Avatar | null;
  effect: AvatarVFXCatalogEntry | null;
  appliedId: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  useFrame(({ camera, size, gl }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const guides = effect
      ? (avatar?.vfxController?.getPlacementGuides(effect, appliedId) ?? null)
      : null;
    drawPlacementGuides(
      canvas,
      guides,
      camera,
      size.width,
      size.height,
      gl.getPixelRatio(),
    );
  });
  return null;
}
