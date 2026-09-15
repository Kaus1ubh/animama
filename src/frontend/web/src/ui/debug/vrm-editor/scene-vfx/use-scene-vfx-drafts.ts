"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  ResolvedSceneBackgroundLayersVFXEntry,
  ResolvedSceneFocusLinesVFXEntry,
  SceneBackgroundLayersVFXEntry,
  SceneFocusLinesVFXEntry,
} from "@/lib/scene-vfx/types";
import {
  cloneSceneBackgroundLayersVFXEntry,
  cloneSceneFocusLinesVFXEntry,
  type SceneFocusLinesVFXPresetId,
  type SceneVFXPresetId,
} from "@/lib/scene-vfx/presets";
import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import {
  getSceneFocusLinesDraftFromPresetId,
  getSceneFocusLinesPresetMatchId,
  getSceneVFXDraftFromPresetId,
  getSceneVFXPresetMatchId,
  toSceneFocusLinesPreviewEntry,
  toSceneFocusLinesRestorableEntry,
  toSceneVFXPreviewEntry,
  toSceneVFXRestorableEntry,
  type SceneFocusLinesDraftPresetId,
  type SceneVFXDraftPresetId,
} from "./helpers";

type SceneBackgroundRuntimeEntry = {
  entry: ResolvedSceneBackgroundLayersVFXEntry;
  expiresAtMs: number | null;
} | null;

type SceneFocusLinesRuntimeEntry = {
  entry: ResolvedSceneFocusLinesVFXEntry;
  expiresAtMs: number | null;
} | null;

type SceneDraftUpdateOptions = { markCustom?: boolean };

export type SceneBackgroundDraftController = {
  activeRuntime: SceneBackgroundRuntimeEntry;
  draft: SceneBackgroundLayersVFXEntry | null;
  resetBase: SceneBackgroundLayersVFXEntry | null;
  presetId: SceneVFXDraftPresetId;
  previewActive: boolean;
  updateDraft: (
    updater: (
      current: SceneBackgroundLayersVFXEntry,
    ) => SceneBackgroundLayersVFXEntry,
    options?: SceneDraftUpdateOptions,
  ) => void;
  handlePresetSelect: (value: string) => void;
  handlePreview: () => void;
  handleApply: () => void;
  handleResetDraft: () => void;
  handleClearLive: () => void;
};

export type SceneFocusLinesDraftController = {
  activeRuntime: SceneFocusLinesRuntimeEntry;
  draft: SceneFocusLinesVFXEntry | null;
  resetBase: SceneFocusLinesVFXEntry | null;
  presetId: SceneFocusLinesDraftPresetId;
  previewActive: boolean;
  updateDraft: (
    updater: (current: SceneFocusLinesVFXEntry) => SceneFocusLinesVFXEntry,
    options?: SceneDraftUpdateOptions,
  ) => void;
  handlePresetSelect: (value: string) => void;
  handlePreview: () => void;
  handleApply: () => void;
  handleResetDraft: () => void;
  handleClearLive: () => void;
};

export type SceneVFXDraftControllers = {
  background: SceneBackgroundDraftController;
  focusLines: SceneFocusLinesDraftController;
};

export function useSceneVFXDrafts({
  open,
  targetKey,
}: {
  open: boolean;
  targetKey: string | null;
}): SceneVFXDraftControllers {
  const [sceneBackgroundDraft, setSceneBackgroundDraft] =
    useState<SceneBackgroundLayersVFXEntry | null>(null);
  const [sceneBackgroundResetBase, setSceneBackgroundResetBase] =
    useState<SceneBackgroundLayersVFXEntry | null>(null);
  const [sceneBackgroundDraftPresetId, setSceneBackgroundDraftPresetId] =
    useState<SceneVFXDraftPresetId>("kawaii-sparkles");
  const [sceneFocusLinesDraft, setSceneFocusLinesDraft] =
    useState<SceneFocusLinesVFXEntry | null>(null);
  const [sceneFocusLinesResetBase, setSceneFocusLinesResetBase] =
    useState<SceneFocusLinesVFXEntry | null>(null);
  const [sceneFocusLinesDraftPresetId, setSceneFocusLinesDraftPresetId] =
    useState<SceneFocusLinesDraftPresetId>("dark");
  const [sceneVfxDraftTargetKey, setSceneVfxDraftTargetKey] = useState<
    string | null
  >(null);
  const [sceneBackgroundPreviewActive, setSceneBackgroundPreviewActive] =
    useState(false);
  const [
    sceneBackgroundPreviewRestoreEntry,
    setSceneBackgroundPreviewRestoreEntry,
  ] = useState<SceneBackgroundLayersVFXEntry | null>(null);
  const [sceneFocusLinesPreviewActive, setSceneFocusLinesPreviewActive] =
    useState(false);
  const [
    sceneFocusLinesPreviewRestoreEntry,
    setSceneFocusLinesPreviewRestoreEntry,
  ] = useState<SceneFocusLinesVFXEntry | null>(null);

  const activeBackgroundSceneVfx = useSceneVFXStore(
    (state) => state.activeByKind.background_layers ?? null,
  );
  const activeFocusLinesSceneVfx = useSceneVFXStore(
    (state) => state.activeByKind.focus_lines ?? null,
  );
  const applySceneVFX = useSceneVFXStore((state) => state.applySceneVFX);
  const clearSceneVFXKind = useSceneVFXStore(
    (state) => state.clearSceneVFXKind,
  );

  const clearSceneBackgroundPreview = useCallback(
    (mode: "restore" | "discard" = "restore") => {
      if (!sceneBackgroundPreviewActive) {
        return;
      }

      if (mode === "restore" && sceneBackgroundPreviewRestoreEntry) {
        applySceneVFX(
          cloneSceneBackgroundLayersVFXEntry(
            sceneBackgroundPreviewRestoreEntry,
          ),
        );
      } else {
        clearSceneVFXKind("background_layers");
      }

      setSceneBackgroundPreviewActive(false);
      setSceneBackgroundPreviewRestoreEntry(null);
    },
    [
      applySceneVFX,
      clearSceneVFXKind,
      sceneBackgroundPreviewActive,
      sceneBackgroundPreviewRestoreEntry,
    ],
  );

  const clearSceneFocusLinesPreview = useCallback(
    (mode: "restore" | "discard" = "restore") => {
      if (!sceneFocusLinesPreviewActive) {
        return;
      }

      if (mode === "restore" && sceneFocusLinesPreviewRestoreEntry) {
        applySceneVFX(
          cloneSceneFocusLinesVFXEntry(sceneFocusLinesPreviewRestoreEntry),
        );
      } else {
        clearSceneVFXKind("focus_lines");
      }

      setSceneFocusLinesPreviewActive(false);
      setSceneFocusLinesPreviewRestoreEntry(null);
    },
    [
      applySceneVFX,
      clearSceneVFXKind,
      sceneFocusLinesPreviewActive,
      sceneFocusLinesPreviewRestoreEntry,
    ],
  );

  useEffect(() => {
    if (open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      clearSceneBackgroundPreview("restore");
      clearSceneFocusLinesPreview("restore");
    });

    return () => {
      cancelled = true;
    };
  }, [clearSceneBackgroundPreview, clearSceneFocusLinesPreview, open]);

  useEffect(() => {
    if (!open || !targetKey) {
      return;
    }

    const needsReseed =
      sceneVfxDraftTargetKey !== targetKey ||
      sceneBackgroundDraft === null ||
      sceneFocusLinesDraft === null;
    if (!needsReseed) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if (sceneBackgroundPreviewActive) {
        clearSceneBackgroundPreview("restore");
      }
      if (sceneFocusLinesPreviewActive) {
        clearSceneFocusLinesPreview("restore");
      }

      const seededBackgroundEntry = activeBackgroundSceneVfx
        ? toSceneVFXRestorableEntry(activeBackgroundSceneVfx)
        : getSceneVFXDraftFromPresetId("kawaii-sparkles");
      const seededFocusLinesEntry = activeFocusLinesSceneVfx
        ? toSceneFocusLinesRestorableEntry(activeFocusLinesSceneVfx)
        : getSceneFocusLinesDraftFromPresetId("dark");

      setSceneBackgroundDraft(seededBackgroundEntry);
      setSceneBackgroundResetBase(
        cloneSceneBackgroundLayersVFXEntry(seededBackgroundEntry),
      );
      setSceneBackgroundDraftPresetId(
        getSceneVFXPresetMatchId(seededBackgroundEntry),
      );
      setSceneFocusLinesDraft(seededFocusLinesEntry);
      setSceneFocusLinesResetBase(
        cloneSceneFocusLinesVFXEntry(seededFocusLinesEntry),
      );
      setSceneFocusLinesDraftPresetId(
        getSceneFocusLinesPresetMatchId(seededFocusLinesEntry),
      );
      setSceneVfxDraftTargetKey(targetKey);
      setSceneBackgroundPreviewActive(false);
      setSceneBackgroundPreviewRestoreEntry(null);
      setSceneFocusLinesPreviewActive(false);
      setSceneFocusLinesPreviewRestoreEntry(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeBackgroundSceneVfx,
    activeFocusLinesSceneVfx,
    clearSceneBackgroundPreview,
    clearSceneFocusLinesPreview,
    open,
    sceneBackgroundDraft,
    sceneBackgroundPreviewActive,
    sceneFocusLinesDraft,
    sceneFocusLinesPreviewActive,
    sceneVfxDraftTargetKey,
    targetKey,
  ]);

  const updateSceneBackgroundDraft = useCallback(
    (
      updater: (
        current: SceneBackgroundLayersVFXEntry,
      ) => SceneBackgroundLayersVFXEntry,
      options?: SceneDraftUpdateOptions,
    ) => {
      setSceneBackgroundDraft((current) =>
        current ? updater(current) : current,
      );
      if (options?.markCustom !== false) {
        setSceneBackgroundDraftPresetId("custom");
      }
    },
    [],
  );

  const handleSceneBackgroundPresetSelect = useCallback((value: string) => {
    const nextDraft = getSceneVFXDraftFromPresetId(value as SceneVFXPresetId);
    setSceneBackgroundDraft(nextDraft);
    setSceneBackgroundResetBase(cloneSceneBackgroundLayersVFXEntry(nextDraft));
    setSceneBackgroundDraftPresetId(value as SceneVFXPresetId);
  }, []);

  const updateSceneFocusLinesDraft = useCallback(
    (
      updater: (current: SceneFocusLinesVFXEntry) => SceneFocusLinesVFXEntry,
      options?: SceneDraftUpdateOptions,
    ) => {
      setSceneFocusLinesDraft((current) =>
        current ? updater(current) : current,
      );
      if (options?.markCustom !== false) {
        setSceneFocusLinesDraftPresetId("custom");
      }
    },
    [],
  );

  const handleSceneFocusLinesPresetSelect = useCallback((value: string) => {
    const nextDraft = getSceneFocusLinesDraftFromPresetId(
      value as SceneFocusLinesVFXPresetId,
    );
    setSceneFocusLinesDraft(nextDraft);
    setSceneFocusLinesResetBase(cloneSceneFocusLinesVFXEntry(nextDraft));
    setSceneFocusLinesDraftPresetId(value as SceneFocusLinesVFXPresetId);
  }, []);

  const handleSceneBackgroundPreview = useCallback(() => {
    if (!sceneBackgroundDraft) return;

    if (!sceneBackgroundPreviewActive) {
      setSceneBackgroundPreviewRestoreEntry(
        activeBackgroundSceneVfx
          ? toSceneVFXRestorableEntry(activeBackgroundSceneVfx)
          : null,
      );
    }

    if (!sceneBackgroundDraft.enabled) {
      clearSceneVFXKind("background_layers");
      setSceneBackgroundPreviewActive(true);
      return;
    }

    applySceneVFX(toSceneVFXPreviewEntry(sceneBackgroundDraft));
    setSceneBackgroundPreviewActive(true);
  }, [
    activeBackgroundSceneVfx,
    applySceneVFX,
    clearSceneVFXKind,
    sceneBackgroundDraft,
    sceneBackgroundPreviewActive,
  ]);

  const handleSceneBackgroundApply = useCallback(() => {
    if (!sceneBackgroundDraft) return;

    setSceneBackgroundPreviewActive(false);
    setSceneBackgroundPreviewRestoreEntry(null);

    if (!sceneBackgroundDraft.enabled) {
      clearSceneVFXKind("background_layers");
      return;
    }

    applySceneVFX(cloneSceneBackgroundLayersVFXEntry(sceneBackgroundDraft));
  }, [applySceneVFX, clearSceneVFXKind, sceneBackgroundDraft]);

  const handleSceneBackgroundResetDraft = useCallback(() => {
    if (!sceneBackgroundResetBase) return;
    const nextDraft = cloneSceneBackgroundLayersVFXEntry(
      sceneBackgroundResetBase,
    );
    setSceneBackgroundDraft(nextDraft);
    setSceneBackgroundDraftPresetId(getSceneVFXPresetMatchId(nextDraft));
  }, [sceneBackgroundResetBase]);

  const handleSceneBackgroundClearLive = useCallback(() => {
    clearSceneVFXKind("background_layers");
    setSceneBackgroundPreviewActive(false);
    setSceneBackgroundPreviewRestoreEntry(null);
  }, [clearSceneVFXKind]);

  const handleSceneFocusLinesPreview = useCallback(() => {
    if (!sceneFocusLinesDraft) return;

    if (!sceneFocusLinesPreviewActive) {
      setSceneFocusLinesPreviewRestoreEntry(
        activeFocusLinesSceneVfx
          ? toSceneFocusLinesRestorableEntry(activeFocusLinesSceneVfx)
          : null,
      );
    }

    if (!sceneFocusLinesDraft.enabled) {
      clearSceneVFXKind("focus_lines");
      setSceneFocusLinesPreviewActive(true);
      return;
    }

    applySceneVFX(toSceneFocusLinesPreviewEntry(sceneFocusLinesDraft));
    setSceneFocusLinesPreviewActive(true);
  }, [
    activeFocusLinesSceneVfx,
    applySceneVFX,
    clearSceneVFXKind,
    sceneFocusLinesDraft,
    sceneFocusLinesPreviewActive,
  ]);

  const handleSceneFocusLinesApply = useCallback(() => {
    if (!sceneFocusLinesDraft) return;

    setSceneFocusLinesPreviewActive(false);
    setSceneFocusLinesPreviewRestoreEntry(null);

    if (!sceneFocusLinesDraft.enabled) {
      clearSceneVFXKind("focus_lines");
      return;
    }

    applySceneVFX(cloneSceneFocusLinesVFXEntry(sceneFocusLinesDraft));
  }, [applySceneVFX, clearSceneVFXKind, sceneFocusLinesDraft]);

  const handleSceneFocusLinesResetDraft = useCallback(() => {
    if (!sceneFocusLinesResetBase) return;
    const nextDraft = cloneSceneFocusLinesVFXEntry(sceneFocusLinesResetBase);
    setSceneFocusLinesDraft(nextDraft);
    setSceneFocusLinesDraftPresetId(getSceneFocusLinesPresetMatchId(nextDraft));
  }, [sceneFocusLinesResetBase]);

  const handleSceneFocusLinesClearLive = useCallback(() => {
    clearSceneVFXKind("focus_lines");
    setSceneFocusLinesPreviewActive(false);
    setSceneFocusLinesPreviewRestoreEntry(null);
  }, [clearSceneVFXKind]);

  return {
    background: {
      activeRuntime: activeBackgroundSceneVfx,
      draft: sceneBackgroundDraft,
      resetBase: sceneBackgroundResetBase,
      presetId: sceneBackgroundDraftPresetId,
      previewActive: sceneBackgroundPreviewActive,
      updateDraft: updateSceneBackgroundDraft,
      handlePresetSelect: handleSceneBackgroundPresetSelect,
      handlePreview: handleSceneBackgroundPreview,
      handleApply: handleSceneBackgroundApply,
      handleResetDraft: handleSceneBackgroundResetDraft,
      handleClearLive: handleSceneBackgroundClearLive,
    },
    focusLines: {
      activeRuntime: activeFocusLinesSceneVfx,
      draft: sceneFocusLinesDraft,
      resetBase: sceneFocusLinesResetBase,
      presetId: sceneFocusLinesDraftPresetId,
      previewActive: sceneFocusLinesPreviewActive,
      updateDraft: updateSceneFocusLinesDraft,
      handlePresetSelect: handleSceneFocusLinesPresetSelect,
      handlePreview: handleSceneFocusLinesPreview,
      handleApply: handleSceneFocusLinesApply,
      handleResetDraft: handleSceneFocusLinesResetDraft,
      handleClearLive: handleSceneFocusLinesClearLive,
    },
  };
}
