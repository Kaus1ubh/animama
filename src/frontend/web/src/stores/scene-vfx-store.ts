"use client";

import { create } from "zustand";

import { createLogger } from "@/lib/logger";
import {
  buildSceneVFXRuntimeEntry,
  buildSceneVFXRuntimeState,
  type SceneVFXActiveByKind,
} from "@/lib/scene-vfx/runtime-state";
import {
  applySceneVFXPresetOverrides,
  getSceneVFXPresetById,
  type SceneVFXPresetId,
  type SceneVFXPresetOverrides,
} from "@/lib/scene-vfx/presets";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";

export type { SceneVFXActiveByKind } from "@/lib/scene-vfx/runtime-state";

type SceneVFXStoreState = {
  activeByKind: SceneVFXActiveByKind;
  coverUiOverlaysActive: boolean;
  underlayCoverUiOverlaysActive: boolean;
  overlayCoverUiOverlaysActive: boolean;
  applySceneVFX: (entry: SceneVFXEntry) => void;
  applySceneVFXPreset: (
    presetId: SceneVFXPresetId,
    overrides?: SceneVFXPresetOverrides,
  ) => void;
  replaceActiveByKind: (activeByKind: SceneVFXActiveByKind) => void;
  clearSceneVFXKind: (kind: SceneVFXKind) => void;
  clearAllSceneVFX: () => void;
};

const logger = createLogger("SceneVFXStore");

export const useSceneVFXStore = create<SceneVFXStoreState>((set) => ({
  ...buildSceneVFXRuntimeState({}),
  applySceneVFX: (entry) => {
    if (!entry.enabled) {
      set((state) => {
        if (!state.activeByKind[entry.kind]) {
          return state;
        }

        const nextActiveByKind = {
          ...state.activeByKind,
        };
        delete nextActiveByKind[entry.kind];
        logger.info("SceneVFX", "Cleared disabled scene VFX entry", {
          kind: entry.kind,
          effectId: entry.id,
        });
        return buildSceneVFXRuntimeState(nextActiveByKind);
      });
      return;
    }

    const runtimeEntry = buildSceneVFXRuntimeEntry(entry);
    set((state) => {
      const nextActiveByKind: SceneVFXActiveByKind = {
        ...state.activeByKind,
        [runtimeEntry.kind]: runtimeEntry,
      };
      logger.info("SceneVFX", "Applied scene VFX entry", {
        kind: runtimeEntry.kind,
        effectId: runtimeEntry.entry.id,
        coverUiOverlays: runtimeEntry.entry.coverUiOverlays,
        durationMs: runtimeEntry.entry.durationMs,
      });
      return buildSceneVFXRuntimeState(nextActiveByKind);
    });
  },
  applySceneVFXPreset: (presetId, overrides) => {
    const preset = getSceneVFXPresetById(presetId);
    if (!preset) {
      set((state) => {
        if (!state.activeByKind.background_layers) {
          return state;
        }

        const nextActiveByKind = {
          ...state.activeByKind,
        };
        delete nextActiveByKind.background_layers;
        logger.info("SceneVFX", "Cleared scene VFX preset", {
          presetId,
        });
        return buildSceneVFXRuntimeState(nextActiveByKind);
      });
      return;
    }

    const mergedPreset =
      preset.kind === "background_layers"
        ? applySceneVFXPresetOverrides(preset, overrides)
        : preset;
    const runtimeEntry = buildSceneVFXRuntimeEntry(mergedPreset);
    set((state) => {
      const nextActiveByKind: SceneVFXActiveByKind = {
        ...state.activeByKind,
        [runtimeEntry.kind]: runtimeEntry,
      };
      logger.info("SceneVFX", "Applied scene VFX preset", {
        presetId,
        kind: runtimeEntry.kind,
        effectId: runtimeEntry.entry.id,
      });
      return buildSceneVFXRuntimeState(nextActiveByKind);
    });
  },
  replaceActiveByKind: (activeByKind) =>
    set(() => buildSceneVFXRuntimeState(activeByKind)),
  clearSceneVFXKind: (kind) =>
    set((state) => {
      if (!state.activeByKind[kind]) {
        return state;
      }

      const nextActiveByKind = {
        ...state.activeByKind,
      };
      delete nextActiveByKind[kind];
      logger.info("SceneVFX", "Cleared scene VFX kind", {
        kind,
      });
      return buildSceneVFXRuntimeState(nextActiveByKind);
    }),
  clearAllSceneVFX: () =>
    set((state) => {
      if (Object.keys(state.activeByKind).length === 0) {
        return state;
      }

      logger.info("SceneVFX", "Cleared all scene VFX");
      return buildSceneVFXRuntimeState({});
    }),
}));
