"use client";

import { useEffect, useMemo } from "react";

import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { useAnimas } from "@/query/hooks/useAnimas";
import { usePreparedContentPreview } from "@/ui/content-preview/usePreparedContentPreview";
import { useSettings } from "@/ui/settings/SettingsProvider";
import {
  contentCreatorModelPreviewTarget,
  contentCreatorModelSourceFromAnima,
  contentCreatorModelSourcesEqual,
  selectContentCreatorPreviewAnima,
  type ContentCreatorModelSource,
  type ContentCreatorPreviewAnimaStatus,
} from "./contentCreatorModelPreview";

export type ContentCreatorModelPreview = {
  previewAnima: PyAnimaListItem | null;
  previewAnimaStatus: ContentCreatorPreviewAnimaStatus;
  runtime: AnimaRuntimeCatalogSnapshot | null;
  modelOptions: ContentCreatorModelSource[];
  selectedModel: ContentCreatorModelSource | null;
  modelEntry: RuntimeCatalogEntry | null;
  modelEntryKey: string | null;
  isAnimaPending: boolean;
  isRuntimePending: boolean;
  isModelCatalogPending: boolean;
  hasMoreModels: boolean;
  isLoadingMoreModels: boolean;
  modelCatalogError: string | null;
  animaError: string | null;
  runtimeError: string | null;
  modelError: string | null;
  selectModel: (source: ContentCreatorModelSource) => void;
  retryAnima: () => Promise<void>;
  retryRuntime: () => Promise<void>;
  retryModels: () => Promise<void>;
  loadMoreModels: () => Promise<void>;
  retrySelectedModel: () => Promise<void>;
};

/**
 * Resolve the last-active Anima's exact model and optional ready App/private
 * model choices without mutating user settings or any Anima loadout.
 */
export function useContentCreatorModelPreview({
  ownerKey,
  selectedModel,
  onSelectModel,
}: {
  ownerKey: string;
  selectedModel: ContentCreatorModelSource | null;
  onSelectModel: (source: ContentCreatorModelSource) => void;
}): ContentCreatorModelPreview {
  const { userSettings, isLoading: settingsLoading } = useSettings();
  const animasQuery = useAnimas();
  const animaSelection = useMemo(
    () =>
      selectContentCreatorPreviewAnima(
        animasQuery.data ?? [],
        userSettings?.last_active_anima_id,
      ),
    [animasQuery.data, userSettings?.last_active_anima_id],
  );
  const previewAnimaId = animaSelection.anima?.id ?? null;
  const runtimeQuery = useAnimaRuntimeCatalog(previewAnimaId);
  const runtime = useMemo(
    () => (runtimeQuery.data ? adaptRuntimeSnapshot(runtimeQuery.data) : null),
    [runtimeQuery.data],
  );
  const equippedModel = useMemo(
    () =>
      previewAnimaId && runtime
        ? contentCreatorModelSourceFromAnima(previewAnimaId, runtime)
        : null,
    [previewAnimaId, runtime],
  );
  const modelOptions = useMemo(
    () => (equippedModel ? [equippedModel] : []),
    [equippedModel],
  );

  useEffect(() => {
    if (equippedModel) {
      if (
        !selectedModel ||
        (selectedModel.sourceType === "resolved_entry" &&
          !contentCreatorModelSourcesEqual(selectedModel, equippedModel))
      ) {
        onSelectModel(equippedModel);
      }
      return;
    }
  }, [
    animasQuery.isSuccess,
    equippedModel,
    onSelectModel,
    previewAnimaId,
    selectedModel,
  ]);

  const target = useMemo(
    () =>
      contentCreatorModelPreviewTarget({
        source: selectedModel,
        animaId: previewAnimaId,
        runtime,
        ownerKey,
      }),
    [ownerKey, previewAnimaId, runtime, selectedModel],
  );
  const preparedModel = usePreparedContentPreview(target, {
    enabled: Boolean(target),
    owner: "management",
  });
  const noModelAvailable =
    animaSelection.status === "none" &&
    animasQuery.isSuccess &&
    modelOptions.length === 0;
  const modelError =
    preparedModel.error ??
    (selectedModel && !target
      ? "The selected Avatar release is no longer available."
      : noModelAvailable
        ? "Create an Anima before previewing this effect on an Avatar."
        : null);

  return {
    previewAnima: animaSelection.anima,
    previewAnimaStatus: animaSelection.status,
    runtime,
    modelOptions,
    selectedModel,
    modelEntry: preparedModel.prepared?.entry ?? null,
    modelEntryKey: preparedModel.prepared?.entryKey ?? null,
    isAnimaPending: settingsLoading || animasQuery.isPending,
    isRuntimePending: Boolean(previewAnimaId) && runtimeQuery.isPending,
    isModelCatalogPending: false,
    hasMoreModels: false,
    isLoadingMoreModels: false,
    modelCatalogError: null,
    animaError: animasQuery.isError ? "Could not load your Animas." : null,
    runtimeError: runtimeQuery.isError
      ? "Could not load the preview Anima's runtime."
      : null,
    modelError,
    selectModel: onSelectModel,
    retryAnima: async () => {
      await animasQuery.refetch();
    },
    retryRuntime: async () => {
      await runtimeQuery.refetch();
    },
    retryModels: async () => undefined,
    loadMoreModels: async () => undefined,
    retrySelectedModel: preparedModel.retry,
  };
}
