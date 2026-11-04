import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  updateUserProfileV1UsersMeProfilePatch,
  type PyUserProfile,
  type PyUserProfileUpdate,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { UserProfileApiError } from "@/lib/user-profile/errors";
import { sdkResultError } from "@/query/sdkResultError";
import { publishUserProfile } from "@/query/mutations/userProfileMutationCache";

/** Update the installation owner's private display-name personalization. */
export function useUpdateUserProfile() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();

  // Rejects with UserProfileApiError for a server refusal, or a transport error
  // when the reply never arrived.
  return useMutation<PyUserProfile, Error, PyUserProfileUpdate>({
    mutationFn: async (body) => {
      const result = await updateUserProfileV1UsersMeProfilePatch({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw sdkResultError(
          result,
          (status, error) => new UserProfileApiError(status, error),
        );
      }
      return result.data;
    },
    onSuccess: (profile) => {
      if (!userId) return;
      publishUserProfile(queryClient, userId, profile);
    },
  });
}
