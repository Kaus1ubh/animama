import { useProductApiClient } from "@animama/product-ui";
import { useQuery } from "@tanstack/react-query";
import { getGestureIdlePlayback } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Inspect only the selected candidate; large VRMA files stay off list requests. */
export function useIdleGesturePlayback(
  itemId: string | null,
  revision: string,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery({
    queryKey: queryKeys.gestures.idlePlayback(
      userId ?? "__anon__",
      itemId ?? "__none__",
      revision,
    ),
    enabled: Boolean(userId && itemId),
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await getGestureIdlePlayback({
          client: apiClient,
          path: { item_id: itemId! },
          signal,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  });
}
