import { animationConfigForPreset } from "@/lib/avatar/vfx/editor";
import type { AvatarVFXAnimationConfig } from "@/lib/avatar/vfx/types";

/** Toggle one motion without discarding the other authored animations. */
export function toggleAvatarEffectAnimation(
  config: AvatarVFXAnimationConfig | null,
  motion: "pulse" | "spin" | "drift",
  enabled: boolean,
): AvatarVFXAnimationConfig | null {
  const next = { ...config };
  if (enabled) return { ...animationConfigForPreset(motion), ...next };
  if (motion === "pulse") {
    delete next.pulseScaleMin;
    delete next.pulseScaleMax;
    delete next.pulseCyclesPerSecond;
  } else if (motion === "spin") {
    delete next.rotationAmountTurns;
    delete next.rotationRadiansPerSecond;
    delete next.rotationDirection;
  } else {
    delete next.driftPerSecond;
  }
  return Object.keys(next).length ? next : null;
}
