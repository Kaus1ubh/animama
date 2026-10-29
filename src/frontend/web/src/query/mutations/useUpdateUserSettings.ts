"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getUserSettingsV1UsersMeSettingsGet,
  patchUserSettingsV1UsersMeSettingsPatch,
} from "@animama/runtime-contracts/sdk";
import type {
  PyUserSettings,
  PyUserSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import {
  mergePreferences,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
import { queryKeys } from "@/query/keys";

export type UpdateUserSettingsArgs = {
  body: PyUserSettingsUpdate;
};

export function useUpdateUserSettings() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyUserSettings, Error, UpdateUserSettingsArgs>({
    mutationFn: async (args) => {
      const { data } = await patchUserSettingsV1UsersMeSettingsPatch({
        client: apiClient,
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

/**
 * Merge a preferences patch into the owner's saved preferences and save them.
 * `PATCH /v1/users/me/settings` replaces the whole preferences object, so this
 * reads the current settings fresh first. Both `SettingsProvider` and setup
 * use it to preserve preferences outside the patch; a failed read makes no write.
 * Merges run one at a time, so overlapping saves (a quickly cycled camera
 * preset, say) each start from the previous one's result.
 */
export function useMergeUserPreferences() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userKey = useRuntimeCacheKey() ?? "__anon__";
  const update = useUpdateUserSettings();
  return useMutation<PyUserSettings, Error, SettingsPreferences>({
    scope: { id: `user-preferences:${userKey}` },
    mutationFn: async (patch) => {
      const current = await queryClient.fetchQuery({
        queryKey: queryKeys.settings.user(userKey),
        staleTime: 0,
        queryFn: async () =>
          (
            await getUserSettingsV1UsersMeSettingsGet({
              client: apiClient,
              responseValidator: undefined,
              throwOnError: true,
            })
          ).data,
      });
      const base = (current.preferences ?? {}) as SettingsPreferences;
      return update.mutateAsync({
        body: { preferences: mergePreferences(base, patch) },
      });
    },
  });
}
