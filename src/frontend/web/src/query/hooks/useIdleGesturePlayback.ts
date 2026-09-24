import { useQuery } from "@tanstack/react-query";
import { getGestureIdlePlayback } from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Inspect only the selected candidate; large VRMA files stay off list requests. */
export function useIdleGesturePlayback(
  itemId: string | null,
  revision: string,
) {
  const userId = useRuntimeOwnerId();
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
          path: { item_id: itemId! },
          signal,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  });
}
