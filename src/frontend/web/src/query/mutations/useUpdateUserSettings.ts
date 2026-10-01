"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getUserSettingsV1UsersMeSettingsGet,
  patchUserSettingsV1UsersMeSettingsPatch,
} from "@animama/runtime-contracts/sdk";
import type {
  PyUserSettings,
  PyUserSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import {
  mergePreferences,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
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

/**
 * Merge a preferences patch into the owner's saved preferences and save them.
 * `PATCH /v1/users/me/settings` replaces the whole preferences object, so this
 * reads the current settings fresh first; callers outside `SettingsProvider`
 * (setup) use it so other preferences are never overwritten.
 */
export function useMergeUserPreferences() {
  const queryClient = useQueryClient();
  const userKey = useRuntimeOwnerId() ?? "__anon__";
  const update = useUpdateUserSettings();
  return useMutation<PyUserSettings, Error, SettingsPreferences>({
    mutationFn: async (patch) => {
      const current = await queryClient.fetchQuery({
        queryKey: queryKeys.settings.user(userKey),
        staleTime: 0,
        queryFn: async () =>
          (
            await getUserSettingsV1UsersMeSettingsGet({
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
