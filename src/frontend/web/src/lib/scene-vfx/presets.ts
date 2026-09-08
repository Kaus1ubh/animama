import {
  cloneSceneBackgroundLineItem,
  toSceneBackgroundLineItemDraft,
} from "./assets";
import {
  getSceneBackgroundLayerPresetById,
  getSceneBackgroundLayerPresetIds,
  getSceneFocusLinePresetById,
  getSceneFocusLinePresetIds,
  type SceneVFXCatalogBackgroundPresetId,
  type SceneVFXCatalogFocusLinesPresetId,
} from "./catalog";
import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  ResolvedSceneFocusLinesVFXEntry,
  SceneBackgroundLayersVFXEntry,
  SceneBackgroundMarqueeLayer,
  SceneBackgroundPatternLayer,
  SceneBackgroundSolidLayer,
  SceneFocusLinesAnimation,
  SceneFocusLinesTarget,
  SceneFocusLinesVFXEntry,
  SceneVFXEntry,
} from "./types";

export type SceneVFXPresetId = "none" | SceneVFXCatalogBackgroundPresetId;

export type SceneFocusLinesVFXPresetId = SceneVFXCatalogFocusLinesPresetId;

export type SceneBackgroundLayersVFXEntryOverrides = Partial<
  Pick<
    SceneBackgroundLayersVFXEntry,
    | "id"
    | "label"
    | "enabled"
    | "durationMs"
    | "coverUiOverlays"
    | "dismissOnInput"
  >
> & {
  solid?: Partial<SceneBackgroundSolidLayer>;
  pattern?: Partial<SceneBackgroundPatternLayer>;
  marquee?: Partial<SceneBackgroundMarqueeLayer>;
};

export type SceneVFXPresetOverrides = SceneBackgroundLayersVFXEntryOverrides;

export const SCENE_VFX_PRESET_IDS: SceneVFXPresetId[] = [
  "none",
  ...getSceneBackgroundLayerPresetIds(),
];

export const SCENE_FOCUS_LINES_VFX_PRESET_IDS: SceneFocusLinesVFXPresetId[] =
  getSceneFocusLinePresetIds();

export function createDefaultSceneBackgroundMarqueeLayer(): SceneBackgroundMarqueeLayer {
  return {
    enabled: false,
    items: [],
    itemSize: 72,
    gap: 24,
    rowGap: 20,
    direction: "diagonal-up-left",
    itemRotationMode: "upright",
    itemRotationOffsetDeg: 0,
    speedPxPerSec: 160,
    opacity: 0.95,
  };
}

export function createEmptySceneBackgroundLayersVFXEntry(
  args?: Partial<
    Pick<SceneBackgroundLayersVFXEntry, "id" | "label" | "enabled">
  >,
): SceneBackgroundLayersVFXEntry {
  return {
    id: args?.id ?? "scene-vfx-empty",
    label: args?.label ?? "None",
    kind: "background_layers",
    enabled: args?.enabled ?? false,
    solid: {
      enabled: true,
      color: "#ffffff",
    },
    pattern: {
      enabled: false,
      pattern: "none",
      color: "#ffffff",
      size: 24,
      spacing: 18,
      opacity: 0.4,
    },
    marquee: createDefaultSceneBackgroundMarqueeLayer(),
  };
}

function cloneSceneFocusLinesTarget(
  target: SceneFocusLinesTarget,
): SceneFocusLinesTarget {
  if (target.kind === "manual_box") {
    return {
      kind: "manual_box",
      rect: {
        ...target.rect,
      },
    };
  }

  return {
    kind: "avatar_face",
    paddingXPx: target.paddingXPx,
    paddingYPx: target.paddingYPx,
  };
}

function cloneSceneFocusLinesAnimation(
  animation: SceneFocusLinesAnimation,
): SceneFocusLinesAnimation {
  return {
    ...animation,
  };
}

export function cloneSceneBackgroundLayersVFXEntry(
  entry: SceneBackgroundLayersVFXEntry,
): SceneBackgroundLayersVFXEntry {
  return {
    ...entry,
    solid: {
      ...entry.solid,
    },
    pattern: {
      ...entry.pattern,
    },
    marquee: {
      ...entry.marquee,
      items: entry.marquee.items.map(cloneSceneBackgroundLineItem),
    },
  };
}

export function cloneSceneFocusLinesVFXEntry(
  entry: SceneFocusLinesVFXEntry,
): SceneFocusLinesVFXEntry {
  return {
    ...entry,
    target: cloneSceneFocusLinesTarget(entry.target),
    animation: cloneSceneFocusLinesAnimation(entry.animation),
  };
}

export function draftSceneBackgroundLayersVFXEntryFromResolved(
  entry: ResolvedSceneBackgroundLayersVFXEntry,
): SceneBackgroundLayersVFXEntry {
  return {
    ...entry,
    solid: {
      ...entry.solid,
    },
    pattern: {
      ...entry.pattern,
    },
    marquee: {
      ...entry.marquee,
      items: entry.marquee.items.map(toSceneBackgroundLineItemDraft),
    },
  };
}

export function draftSceneFocusLinesVFXEntryFromResolved(
  entry: ResolvedSceneFocusLinesVFXEntry,
): SceneFocusLinesVFXEntry {
  return {
    ...entry,
    target: cloneSceneFocusLinesTarget(entry.target),
    animation: cloneSceneFocusLinesAnimation(entry.animation),
    seed: entry.seed,
  };
}

export function applySceneVFXPresetOverrides(
  entry: SceneBackgroundLayersVFXEntry,
  overrides?: SceneVFXPresetOverrides,
): SceneBackgroundLayersVFXEntry {
  if (!overrides) {
    return cloneSceneBackgroundLayersVFXEntry(entry);
  }

  return {
    ...entry,
    ...overrides,
    solid: {
      ...entry.solid,
      ...(overrides.solid ?? {}),
    },
    pattern: {
      ...entry.pattern,
      ...(overrides.pattern ?? {}),
    },
    marquee: {
      ...entry.marquee,
      ...(overrides.marquee ?? {}),
      items: overrides.marquee?.items
        ? overrides.marquee.items.map(cloneSceneBackgroundLineItem)
        : entry.marquee.items.map(cloneSceneBackgroundLineItem),
    },
  };
}

export function getSceneVFXPresetById(
  presetId: SceneVFXPresetId,
): SceneVFXEntry | null {
  if (presetId === "none") {
    return null;
  }

  return getSceneBackgroundLayerPresetById(presetId);
}

export function getSceneFocusLinesVFXPresetById(
  presetId: SceneFocusLinesVFXPresetId,
): SceneFocusLinesVFXEntry {
  const preset = getSceneFocusLinePresetById(presetId);
  if (!preset) {
    throw new Error(`Unknown scene focus-lines VFX preset "${presetId}".`);
  }
  return preset;
}
