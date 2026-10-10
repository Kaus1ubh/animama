import { useProductApiClient } from "@animama/product-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getI18n } from "react-i18next";

import {
  installModelAssetV1ModelAssetsAssetIdInstallPost,
  removeModelAssetV1ModelAssetsAssetIdDelete,
} from "@animama/runtime-contracts/sdk";
import type {
  PyModelAssetList,
  PyModelAssetState,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { WordedError } from "@/lib/errors/apiError";
import { queryKeys } from "@/query/keys";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import {
  assertAssetInstallAllowed,
  DownloadGuardError,
  downloadGuardText,
  modelAssetActionKey,
  PACK_WORK_BLOCKS_ASSET,
  pulseAssetAttempts,
  recordAssetAttempt,
} from "@/query/model-download-coordination";

export type ModelAssetAction = "install" | "remove";

/**
 * Start (or join) a verified install, or cancel/remove an asset. The returned
 * state replaces the cached entry at once, so progress polling starts without
 * waiting for a refetch.
 */
export function useModelAssetAction() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const ownerId = useRuntimeCacheKey();
  const owner = ownerId ?? "__anon__";
  const key = queryKeys.modelAssets(owner);
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const packs = useDesktopFeaturePacks();

  const mutation = useMutation<
    PyModelAssetState,
    Error,
    { action: ModelAssetAction; assetId: string }
  >({
    mutationKey: modelAssetActionKey(owner),
    mutationFn: async ({ action, assetId }) => {
      const t = getI18n().getFixedT(null, "voice");
      if (!ownerId) throw new WordedError(t("downloads.errors.notReady"));
      if (action === "install") {
        try {
          await assertAssetInstallAllowed(queryClient, owner, desktop);
        } catch (cause) {
          // IPC failures may contain host paths. Keep the known guard refusal only.
          throw cause instanceof DownloadGuardError
            ? cause
            : new WordedError(t("downloads.errors.statusUnavailable"));
        }
        recordAssetAttempt(queryClient, owner, assetId, true);
      } else {
        pulseAssetAttempts(queryClient, owner);
      }
      const options = {
        path: { asset_id: assetId },
        throwOnError: true,
      } as const;
      const { data } =
        action === "install"
          ? await installModelAssetV1ModelAssetsAssetIdInstallPost({
              ...options,
              client: apiClient,
            })
          : await removeModelAssetV1ModelAssetsAssetIdDelete({
              ...options,
              client: apiClient,
            });
      if (action === "remove" || data.status === "installed")
        recordAssetAttempt(queryClient, owner, assetId, false);
      return data;
    },
    onSuccess: (state) => {
      queryClient.setQueryData<PyModelAssetList>(key, (current) =>
        current
          ? {
              ...current,
              assets: current.assets.map((asset) =>
                asset.id === state.id ? state : asset,
              ),
            }
          : current,
      );
    },
    onSettled: () => {
      // Begin can be observed before a held POST starts the backend job. Wake
      // sibling windows again on every outcome without inventing download state.
      if (ownerId) pulseAssetAttempts(queryClient, owner);
      // Free space changes with every install or removal.
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  return {
    ...mutation,
    busy: packs.busy,
    blockedReason: packs.busy
      ? downloadGuardText(PACK_WORK_BLOCKS_ASSET)
      : null,
  };
}
