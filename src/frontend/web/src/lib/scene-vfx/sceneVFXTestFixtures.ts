/**
 * Synthetic Scene background entries for tests. The bundled catalog holds only
 * the focus presets; Included backgrounds reach the runtime from the backend.
 */
import { parseSceneVFXEntry } from "./catalog";
import type { SceneBackgroundLayersVFXEntry } from "./types";

/** A held pink background with a heart pattern and an empty marquee. */
export function createTestSceneBackground(
  overrides: Partial<SceneBackgroundLayersVFXEntry> = {},
): SceneBackgroundLayersVFXEntry {
  return parseSceneVFXEntry({
    id: "test-scene-background",
    label: "Test background",
    kind: "background_layers",
    enabled: true,
    durationMs: null,
    dismissOnInput: false,
    coverUiOverlays: false,
    solid: { enabled: true, color: "#ffd7ea" },
    pattern: {
      enabled: true,
      pattern: "heart",
      color: "#ffffff",
      size: 26,
      spacing: 20,
      opacity: 0.55,
    },
    marquee: {
      enabled: true,
      items: [],
      itemSize: 72,
      gap: 24,
      rowGap: 20,
      direction: "diagonal-up-left",
      itemRotationMode: "upright",
      itemRotationOffsetDeg: 0,
      speedPxPerSec: 160,
      opacity: 0.95,
    },
    ...overrides,
  }) as SceneBackgroundLayersVFXEntry;
}
