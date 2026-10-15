import { useProductApiClient } from "@animama/product-ui";
import { useQueryClient } from "@tanstack/react-query";
import type { PyIdlePlayback } from "@animama/runtime-contracts/api-types";
import { getGestureIdlePlayback } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/**
 * Check one Gesture's finite idle playback on demand. Large VRMA files stay off
 * list requests; `known` returns an earlier result for the same revision.
 */
export function useIdleGesturePlaybackCheck() {
  const apiClient = useProductApiClient();
  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey() ?? "__anon__";
  const key = (itemId: string, revision: string) =>
    queryKeys.gestures.idlePlayback(userId, itemId, revision);
  return {
    known: (itemId: string, revision: string) =>
      queryClient.getQueryData<PyIdlePlayback>(key(itemId, revision)),
    check: (itemId: string, revision: string) =>
      queryClient.fetchQuery({
        queryKey: key(itemId, revision),
        retry: false,
        queryFn: async ({ signal }) =>
          (
            await getGestureIdlePlayback({
              client: apiClient,
              path: { item_id: itemId },
              signal,
              responseValidator: undefined,
              throwOnError: true,
            })
          ).data,
      }),
  };
}
