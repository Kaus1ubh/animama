import { useQuery } from "@tanstack/react-query";

import type { AvatarFacePartsState } from "@animama/runtime-contracts/api-types";
import { getAvatarFaceParts } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { useProductApiClient } from "@animama/product-ui";

/** An Avatar's effective face part correction and the revision it applies to. */
export function useAvatarFaceParts(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  const client = useProductApiClient();
  return useQuery<AvatarFacePartsState>({
    queryKey: queryKeys.avatars.faceParts(
      userId ?? "__anon__",
      itemId ?? "__none__",
    ),
    enabled: Boolean(userId && itemId),
    queryFn: async ({ signal }) =>
      (
        await getAvatarFaceParts({
          client,
          path: { item_id: itemId! },
          signal,
          throwOnError: true,
        })
      ).data,
  });
}
