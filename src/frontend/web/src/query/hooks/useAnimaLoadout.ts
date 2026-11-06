import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { getAnimaLoadoutV1AnimasAnimaIdLoadoutGet } from "@animama/runtime-contracts/sdk";
import type { PyAnimaLoadout } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Effective Gesture/Reaction state; callers never merge support resources. */
export function useAnimaLoadout(animaId: string | null | undefined) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery<PyAnimaLoadout>({
    queryKey: queryKeys.animaLoadouts.detail(
      userId ?? "__anon__",
      animaId ?? "__none__",
    ),
    enabled: Boolean(userId && animaId),
    queryFn: async () => {
      if (!animaId) throw new Error("An Anima is required");
      const { data } = await getAnimaLoadoutV1AnimasAnimaIdLoadoutGet({
        client: apiClient,
        path: { anima_id: animaId },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
