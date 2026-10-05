"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  updateUserProfileV1UsersMeProfilePatch,
  type PyUserProfile,
  type PyUserProfileUpdate,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { UserProfileApiError } from "@/lib/user-profile/errors";
import { publishUserProfile } from "@/query/mutations/userProfileMutationCache";

/** Update the installation owner's private display-name personalization. */
export function useUpdateUserProfile() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();

  return useMutation<PyUserProfile, UserProfileApiError, PyUserProfileUpdate>({
    mutationFn: async (body) => {
      const result = await updateUserProfileV1UsersMeProfilePatch({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw new UserProfileApiError(result.response.status, result.error);
      }
      return result.data;
    },
    onSuccess: (profile) => {
      if (!userId) return;
      publishUserProfile(queryClient, userId, profile);
    },
  });
}
