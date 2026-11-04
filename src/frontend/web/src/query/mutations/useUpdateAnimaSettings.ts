import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchAnimaSettingsV1AnimasAnimaIdSettingsPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaSettings,
  PyAnimaSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UpdateAnimaSettingsArgs = {
  animaId: string;
  body: PyAnimaSettingsUpdate;
};

export function useUpdateAnimaSettings() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyAnimaSettings, Error, UpdateAnimaSettingsArgs>({
    mutationFn: async (args) => {
      const { data } = await patchAnimaSettingsV1AnimasAnimaIdSettingsPatch({
        client: apiClient,
        path: { anima_id: args.animaId },
        body: args.body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (settings) => {
      if (!userId) return;
      queryClient.setQueryData(
        queryKeys.settings.anima(userKey, settings.anima_id),
        settings,
      );
    },
    onSettled: (_data, _error, args) => {
      if (!userId) return;
      if (args?.animaId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.settings.anima(userKey, args.animaId),
        });
      }
    },
  });
}
