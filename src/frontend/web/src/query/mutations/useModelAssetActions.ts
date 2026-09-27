import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  installModelAssetV1ModelAssetsAssetIdInstallPost,
  removeModelAssetV1ModelAssetsAssetIdDelete,
} from "@animama/runtime-contracts/sdk";
import type {
  PyModelAssetList,
  PyModelAssetState,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type ModelAssetAction = "install" | "remove";

/**
 * Start (or join) a verified install, or cancel/remove an asset. The returned
 * state replaces the cached entry at once, so progress polling starts without
 * waiting for a refetch.
 */
export function useModelAssetAction() {
  const queryClient = useQueryClient();
  const ownerId = useRuntimeOwnerId();
  const key = queryKeys.modelAssets(ownerId ?? "__anon__");

  return useMutation<
    PyModelAssetState,
    Error,
    { action: ModelAssetAction; assetId: string }
  >({
    mutationFn: async ({ action, assetId }) => {
      const options = {
        path: { asset_id: assetId },
        throwOnError: true,
      } as const;
      const { data } =
        action === "install"
          ? await installModelAssetV1ModelAssetsAssetIdInstallPost(options)
          : await removeModelAssetV1ModelAssetsAssetIdDelete(options);
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
      // Free space changes with every install or removal.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
