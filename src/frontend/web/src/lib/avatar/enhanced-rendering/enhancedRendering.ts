import * as THREE from "three";
import { create } from "zustand";

/*
 * Enhanced Avatar rendering, the Advanced setting "Enable enhanced renderer and
 * shaders" (`presentation.enhanced_rendering`, on by default). When on:
 * - VRoid MToon materials are retuned at load (`mtoonPatch.ts`): coloured
 *   shadows, a crisper terminator, rim light and screen-space outlines;
 * - Avatar canvases use three-point lighting and Neutral tone mapping at a
 *   slightly higher exposure (`AvatarSceneLighting`);
 * - the chat canvas gets a soft colour grade and a glow around the Avatar.
 * Off restores the classic look: unmodified MToon, one key light and ACES.
 */

type State = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

type RenderingWindow = Window & { __animamaRenderingOverride?: unknown };

/** Review renderers pick a look through a window override; the app starts enhanced. */
function readInitialEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const override = (window as RenderingWindow).__animamaRenderingOverride;
  return override !== "classic";
}

/**
 * The active setting. `SettingsProvider` keeps it in step with app
 * preferences; non-React code (the glTF patch, review renderers) reads it.
 */
export const useEnhancedRenderingStore = create<State>((set) => ({
  enabled: readInitialEnabled(),
  setEnabled: (enabled) => set({ enabled }),
}));

export function isEnhancedRenderingEnabled(): boolean {
  return useEnhancedRenderingStore.getState().enabled;
}

/** Tone-mapping exposure for enhanced rendering (classic stays at 1). */
export const ENHANCED_TONE_MAPPING_EXPOSURE = 1.1;

/** Apply the look's tone mapping and exposure to an Avatar renderer. */
export function applyAvatarToneMapping(
  renderer: THREE.WebGLRenderer,
  enhanced: boolean,
): void {
  renderer.toneMapping = enhanced
    ? THREE.NeutralToneMapping
    : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = enhanced ? ENHANCED_TONE_MAPPING_EXPOSURE : 1;
}

/**
 * The chat canvas's CSS filter: slightly brighter, softer and less saturated,
 * with a soft white glow around the Avatar. A browser filter stands in for
 * colour grading and bloom, which the transparent canvas makes costly in WebGL.
 */
export const ENHANCED_CHAT_CANVAS_FILTER =
  "brightness(1.04) contrast(0.92) saturate(0.88) drop-shadow(0 0 6px rgba(255, 255, 255, 0.55))";
