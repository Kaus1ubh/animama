"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchAnimaSettingsV1AnimasAnimaIdSettingsPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaSettings,
  PyAnimaSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UpdateAnimaSettingsArgs = {
  animaId: string;
  body: PyAnimaSettingsUpdate;
};

export function useUpdateAnimaSettings() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<PyAnimaSettings, Error, UpdateAnimaSettingsArgs>({
    mutationFn: async (args) => {
      const { data } = await patchAnimaSettingsV1AnimasAnimaIdSettingsPatch({
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
