"use client";

import { useState } from "react";

import type { AvatarVFXCatalogEntry } from "@/lib/avatar";
import { cloneCatalogEffectEntry } from "./helpers";

export type VFXCatalogDraftController = {
  getEffectDraft: (effect: AvatarVFXCatalogEntry) => AvatarVFXCatalogEntry;
  setEffectDraft: (
    effectId: string,
    updater: (current: AvatarVFXCatalogEntry) => AvatarVFXCatalogEntry,
  ) => void;
  resetEffectDraft: (effectId: string) => void;
};

type VFXCatalogDraftState = Record<string, AvatarVFXCatalogEntry>;

export function useVFXCatalogDrafts({
  targetKey,
  catalog,
}: {
  targetKey: string | null;
  catalog: AvatarVFXCatalogEntry[] | null | undefined;
}): VFXCatalogDraftController {
  const [draftState, setDraftState] = useState<{
    targetKey: string | null;
    drafts: VFXCatalogDraftState;
  }>({
    targetKey,
    drafts: {},
  });
  const drafts = draftState.targetKey === targetKey ? draftState.drafts : {};

  const getEffectDraft = (
    effect: AvatarVFXCatalogEntry,
  ): AvatarVFXCatalogEntry => drafts[effect.id] ?? effect;

  const setEffectDraft = (
    effectId: string,
    updater: (current: AvatarVFXCatalogEntry) => AvatarVFXCatalogEntry,
  ) => {
    const baseEffect = catalog?.find((entry) => entry.id === effectId) ?? null;
    if (!baseEffect) return;

    setDraftState((current) => {
      const currentDrafts =
        current.targetKey === targetKey ? current.drafts : {};
      const previous =
        currentDrafts[effectId] ?? cloneCatalogEffectEntry(baseEffect);
      return {
        targetKey,
        drafts: {
          ...currentDrafts,
          [effectId]: updater(previous),
        },
      };
    });
  };

  const resetEffectDraft = (effectId: string) => {
    setDraftState((current) => {
      const currentDrafts =
        current.targetKey === targetKey ? current.drafts : {};
      const next = { ...currentDrafts };
      delete next[effectId];
      return {
        targetKey,
        drafts: next,
      };
    });
  };

  return {
    getEffectDraft,
    setEffectDraft,
    resetEffectDraft,
  };
}
