"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchUserSettingsV1UsersMeSettingsPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyUserSettings,
  PyUserSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UpdateUserSettingsArgs = {
  body: PyUserSettingsUpdate;
};

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<PyUserSettings, Error, UpdateUserSettingsArgs>({
    mutationFn: async (args) => {
      const { data } = await patchUserSettingsV1UsersMeSettingsPatch({
        body: args.body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (settings) => {
      if (!userId) return;
      queryClient.setQueryData(queryKeys.settings.user(userKey), settings);
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.all(userKey),
      });
    },
  });
}
