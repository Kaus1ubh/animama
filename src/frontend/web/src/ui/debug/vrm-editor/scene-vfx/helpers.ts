"use client";

import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  ResolvedSceneFocusLinesVFXEntry,
  SceneBackgroundLayersVFXEntry,
  SceneFocusLinesVFXEntry,
} from "@/lib/scene-vfx/types";
import {
  SCENE_FOCUS_LINES_VFX_PRESET_IDS,
  SCENE_VFX_PRESET_IDS,
  cloneSceneBackgroundLayersVFXEntry,
  cloneSceneFocusLinesVFXEntry,
  createEmptySceneBackgroundLayersVFXEntry,
  draftSceneBackgroundLayersVFXEntryFromResolved,
  draftSceneFocusLinesVFXEntryFromResolved,
  getSceneFocusLinesVFXPresetById,
  getSceneVFXPresetById,
  type SceneFocusLinesVFXPresetId,
  type SceneVFXPresetId,
} from "@/lib/scene-vfx/presets";

export type SceneVFXDraftPresetId = SceneVFXPresetId | "custom";
export type SceneFocusLinesDraftPresetId =
  | SceneFocusLinesVFXPresetId
  | "custom";

export function getSceneVFXDraftFromPresetId(
  presetId: SceneVFXPresetId,
): SceneBackgroundLayersVFXEntry {
  if (presetId === "none") {
    return createEmptySceneBackgroundLayersVFXEntry();
  }

  const preset = getSceneVFXPresetById(presetId);
  if (preset?.kind === "background_layers") {
    return cloneSceneBackgroundLayersVFXEntry(preset);
  }

  return createEmptySceneBackgroundLayersVFXEntry();
}

export function getSceneFocusLinesDraftFromPresetId(
  presetId: SceneFocusLinesVFXPresetId,
): SceneFocusLinesVFXEntry {
  return cloneSceneFocusLinesVFXEntry(
    getSceneFocusLinesVFXPresetById(presetId),
  );
}

function areSceneBackgroundEntriesEqual(
  left: SceneBackgroundLayersVFXEntry,
  right: SceneBackgroundLayersVFXEntry,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getSceneVFXPresetMatchId(
  entry: SceneBackgroundLayersVFXEntry,
): SceneVFXDraftPresetId {
  for (const presetId of SCENE_VFX_PRESET_IDS) {
    const presetDraft = getSceneVFXDraftFromPresetId(presetId);
    if (areSceneBackgroundEntriesEqual(entry, presetDraft)) {
      return presetId;
    }
  }

  return "custom";
}

function areSceneFocusLinesEntriesEqual(
  left: SceneFocusLinesVFXEntry,
  right: SceneFocusLinesVFXEntry,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getSceneFocusLinesPresetMatchId(
  entry: SceneFocusLinesVFXEntry,
): SceneFocusLinesDraftPresetId {
  for (const presetId of SCENE_FOCUS_LINES_VFX_PRESET_IDS) {
    const presetDraft = getSceneFocusLinesDraftFromPresetId(presetId);
    if (areSceneFocusLinesEntriesEqual(entry, presetDraft)) {
      return presetId;
    }
  }

  return "custom";
}

export function toSceneVFXRestorableEntry(runtimeEntry: {
  entry: ResolvedSceneBackgroundLayersVFXEntry;
  expiresAtMs: number | null;
}): SceneBackgroundLayersVFXEntry {
  const nextEntry = draftSceneBackgroundLayersVFXEntryFromResolved(
    runtimeEntry.entry,
  );
  nextEntry.durationMs =
    runtimeEntry.expiresAtMs === null
      ? null
      : Math.max(0, runtimeEntry.expiresAtMs - Date.now());
  return nextEntry;
}

export function toSceneVFXPreviewEntry(
  entry: SceneBackgroundLayersVFXEntry,
): SceneBackgroundLayersVFXEntry {
  return {
    ...cloneSceneBackgroundLayersVFXEntry(entry),
    id: `${entry.id}-preview`,
    label: `${entry.label} Preview`,
    durationMs: null,
    dismissOnInput: false,
  };
}

export function toSceneFocusLinesRestorableEntry(runtimeEntry: {
  entry: ResolvedSceneFocusLinesVFXEntry;
  expiresAtMs: number | null;
}): SceneFocusLinesVFXEntry {
  const nextEntry = draftSceneFocusLinesVFXEntryFromResolved(
    runtimeEntry.entry,
  );
  nextEntry.durationMs =
    runtimeEntry.expiresAtMs === null
      ? null
      : Math.max(0, runtimeEntry.expiresAtMs - Date.now());
  return nextEntry;
}

export function toSceneFocusLinesPreviewEntry(
  entry: SceneFocusLinesVFXEntry,
): SceneFocusLinesVFXEntry {
  return {
    ...cloneSceneFocusLinesVFXEntry(entry),
    id: `${entry.id}-preview`,
    label: `${entry.label} Preview`,
    durationMs: null,
    dismissOnInput: false,
  };
}

export function formatSceneVFXDuration(
  value: number | null | undefined,
): string {
  if (value === null) return "Sticky";
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}ms`;
}
