import { describe, expect, it } from "vitest";
import { toggleAvatarEffectAnimation } from "./animationControls";
import { resolveAvatarVFXAnimationConfig } from "@/lib/avatar/vfx/animation";
import {
  avatarEffectDefinition,
  createAvatarEffectDocumentFromDefinition,
  createDefaultAvatarEffectDocument,
} from "@/lib/avatar/vfx/editor";

describe("Avatar Effect animation controls", () => {
  it("combines motions and disables only the selected motion", () => {
    const pulse = {
      pulseScaleMin: 0.7,
      pulseScaleMax: 1.3,
      pulseCyclesPerSecond: 3,
    };
    const both = toggleAvatarEffectAnimation(pulse, "spin", true);
    const all = toggleAvatarEffectAnimation(both, "drift", true);
    expect(all).toMatchObject(pulse);
    expect(resolveAvatarVFXAnimationConfig(all)).toMatchObject({
      pulseEnabled: true,
      spinEnabled: true,
      driftEnabled: true,
    });
    const withoutPulse = toggleAvatarEffectAnimation(all, "pulse", false);
    expect(resolveAvatarVFXAnimationConfig(withoutPulse)).toMatchObject({
      pulseEnabled: false,
      spinEnabled: true,
      driftEnabled: true,
    });
    expect(
      toggleAvatarEffectAnimation(
        toggleAvatarEffectAnimation(withoutPulse, "spin", false),
        "drift",
        false,
      ),
    ).toBeNull();
  });

  it("preserves custom animation values through the saved definition", () => {
    const animationConfig = {
      pulseScaleMin: 0.8,
      pulseScaleMax: 1.4,
      pulseCyclesPerSecond: 0.75,
      rotationAmountTurns: 0.25,
      rotationRadiansPerSecond: 3,
      rotationDirection: "counterclockwise" as const,
      driftPerSecond: { x: -0.04, y: 0.02 },
    };
    const document = {
      ...createDefaultAvatarEffectDocument(),
      animationConfig,
      image: {
        logicalName: "effect.png",
        originalName: "effect.png",
        contentType: "image/png",
        sizeBytes: 42,
        sha256: "a".repeat(64),
      },
    };
    const definition = avatarEffectDefinition(document);
    expect(definition.animationConfig).toEqual(animationConfig);
    const restored = createAvatarEffectDocumentFromDefinition({
      name: "Custom motion",
      description: "",
      definition,
      image: document.image,
      sound: null,
    });
    expect(restored.animationConfig).toEqual(animationConfig);
  });
});
