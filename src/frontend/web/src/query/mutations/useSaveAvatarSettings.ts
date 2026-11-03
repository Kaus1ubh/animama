import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  AvatarSettingsState,
  AvatarSettingsUpdate,
} from "@animama/runtime-contracts/api-types";
import { saveAvatarSettings } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { useProductApiClient } from "@animama/product-ui";

/**
 * Save an Avatar item's wind or material setting (a field left out keeps its
 * value; null returns it to Automatic). Every surface showing the Avatar reads
 * the same query, so the change applies wherever it is shown.
 */
export function useSaveAvatarSettings(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  const client = useProductApiClient();
  const queryClient = useQueryClient();
  return useMutation<AvatarSettingsState, Error, AvatarSettingsUpdate>({
    mutationFn: async (update) => {
      if (!itemId) throw new Error("This Avatar has no saved settings.");
      return (
        await saveAvatarSettings({
          client,
          path: { item_id: itemId },
          body: update,
          throwOnError: true,
        })
      ).data;
    },
    onSuccess: (state) => {
      if (!userId || !itemId) return;
      queryClient.setQueryData(
        queryKeys.avatars.settings(userId, itemId),
        state,
      );
    },
  });
}
