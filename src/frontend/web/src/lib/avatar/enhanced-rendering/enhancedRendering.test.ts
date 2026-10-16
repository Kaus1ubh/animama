import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCENE_LIGHTS,
  ENHANCED_SCENE_LIGHTS,
  avatarSceneLights,
} from "@/ui/main/canvas/sceneCameraPresets";
import {
  ENHANCED_TONE_MAPPING_EXPOSURE,
  applyAvatarToneMapping,
  isEnhancedRenderingEnabled,
} from "./enhancedRendering";

/** Just the tone-mapping fields `applyAvatarToneMapping` writes. */
function toneMappingTarget() {
  return {
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 0,
  } as unknown as THREE.WebGLRenderer;
}

describe("enhanced rendering", () => {
  it("starts enabled, as the app default", () => {
    expect(isEnhancedRenderingEnabled()).toBe(true);
  });

  it("uses Neutral tone mapping at a raised exposure when enhanced", () => {
    const renderer = toneMappingTarget();
    applyAvatarToneMapping(renderer, true);
    expect(renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(renderer.toneMappingExposure).toBe(ENHANCED_TONE_MAPPING_EXPOSURE);
  });

  it("restores the classic ACES curve at exposure 1", () => {
    const renderer = toneMappingTarget();
    applyAvatarToneMapping(renderer, true);
    applyAvatarToneMapping(renderer, false);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it("switches between one key light and three-point lighting", () => {
    expect(avatarSceneLights(false)).toBe(DEFAULT_SCENE_LIGHTS);
    expect(avatarSceneLights(true)).toBe(ENHANCED_SCENE_LIGHTS);
    expect(ENHANCED_SCENE_LIGHTS.directional).toHaveLength(3);
  });
});
