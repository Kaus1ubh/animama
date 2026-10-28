"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { getAutomaticEpisodeProcessingV1MemoryAutomaticProcessingGet } from "@animama/runtime-contracts/sdk";
import type { PyAutomaticEpisodeProcessingStatus } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { queryKeys } from "@/query/keys";

/** How often open views refresh the status: the chat's progress line and the setting's description. */
export const AUTOMATIC_EPISODE_PROCESSING_POLL_MS = 5_000;

/** Whether this runtime processes episode notes automatically (the local composition). */
export function useAutomaticEpisodeProcessingAvailable(): boolean {
  return useRuntimeCapabilities().data?.automatic_episode_processing === true;
}

/**
 * The owner's automatic episode-processing threshold and what it will do next.
 * Only runtimes reporting the `automatic_episode_processing` capability serve
 * the route, so the query runs only there. `refetchInterval` keeps the chat's
 * progress line current; React Query pauses it while the page is hidden.
 */
export function useAutomaticEpisodeProcessing({
  refetchInterval = false,
}: { refetchInterval?: number | false } = {}) {
  const apiClient = useProductApiClient();
  const ownerId = useRuntimeCacheKey();
  const available = useAutomaticEpisodeProcessingAvailable();
  return useQuery<PyAutomaticEpisodeProcessingStatus>({
    queryKey: queryKeys.automaticEpisodeProcessing(ownerId ?? "__anon__"),
    enabled: available && Boolean(ownerId),
    refetchInterval,
    queryFn: async () => {
      const { data } =
        await getAutomaticEpisodeProcessingV1MemoryAutomaticProcessingGet({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
  });
}
