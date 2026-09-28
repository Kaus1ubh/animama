import { useQuery } from "@tanstack/react-query";

import { listModelAssetsV1ModelAssetsGet } from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** How often install progress is refreshed while a download runs. */
const DOWNLOAD_POLL_MS = 1000;

/**
 * Downloadable model assets and the store's free space. Polls only while a
 * download is in flight; installed state is otherwise stable.
 */
export function useModelAssets({ enabled = true }: { enabled?: boolean } = {}) {
  const ownerId = useRuntimeOwnerId();
  return useQuery({
    queryKey: queryKeys.modelAssets(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    queryFn: async ({ signal }) => {
      const { data } = await listModelAssetsV1ModelAssetsGet({
        signal,
        throwOnError: true,
      });
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.assets.some((asset) => asset.status === "downloading")
        ? DOWNLOAD_POLL_MS
        : false,
  });
}
