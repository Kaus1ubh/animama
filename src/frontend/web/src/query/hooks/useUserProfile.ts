"use client";

import { useProductApiClient } from "@animama/product-ui";
import type { Client } from "@animama/runtime-contracts/sdk";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import {
  getUserProfileV1UsersMeProfileGet,
  type PyUserProfile,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type GetUserProfile = () => Promise<PyUserProfile>;

export type UseUserProfileOptions = {
  enabled?: boolean;
};

/** Read the installation owner's private local personalization. */
export async function getCurrentUserProfile(
  apiClient: Client,
): Promise<PyUserProfile> {
  const { data } = await getUserProfileV1UsersMeProfileGet({
    client: apiClient,
    responseValidator: undefined,
    throwOnError: true,
  });
  return data;
}

/** Build the owner-partitioned local personalization query. */
export function userProfileQueryOptions(
  userId: string,
  getProfile: GetUserProfile,
): UseQueryOptions<PyUserProfile> {
  return {
    queryKey: queryKeys.userProfile.current(userId),
    queryFn: getProfile,
    staleTime: 30_000,
    retry: 1,
  };
}

/** Read the active runtime owner's private local personalization. */
export function useUserProfile(options?: UseUserProfileOptions) {
  const apiClient = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  return useQuery({
    ...userProfileQueryOptions(userKey, () => getCurrentUserProfile(apiClient)),
    enabled: Boolean(userId) && (options?.enabled ?? true),
  });
}
