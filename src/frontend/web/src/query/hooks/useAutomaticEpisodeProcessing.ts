import { useProductApiClient } from "@animama/product-ui";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getAutomaticEpisodeProcessingV1MemoryAutomaticProcessingGet } from "@animama/runtime-contracts/sdk";
import type { PyAutomaticEpisodeProcessingStatus } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { queryKeys } from "@/query/keys";

/** How often open views refresh the status: the chat's progress line, the setting's description and the Memory page. */
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
 *
 * Automatic runs change memory files and episode notes on the backend, outside
 * any client mutation. When a refresh shows a run finished or fewer pending
 * notes, the cached memory entries and episodes are invalidated so the Memory
 * page stops showing notes that were already processed.
 */
export function useAutomaticEpisodeProcessing({
  refetchInterval = false,
}: { refetchInterval?: number | false } = {}) {
  const apiClient = useProductApiClient();
  const ownerId = useRuntimeCacheKey();
  const available = useAutomaticEpisodeProcessingAvailable();
  const queryClient = useQueryClient();
  const userKey = ownerId ?? "__anon__";
  const queryKey = queryKeys.automaticEpisodeProcessing(userKey);
  return useQuery<PyAutomaticEpisodeProcessingStatus>({
    queryKey,
    enabled: available && Boolean(ownerId),
    refetchInterval,
    queryFn: async () => {
      const { data } =
        await getAutomaticEpisodeProcessingV1MemoryAutomaticProcessingGet({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        });
      const previous =
        queryClient.getQueryData<PyAutomaticEpisodeProcessingStatus>(queryKey);
      if (previous && automaticRunChangedMemory(previous, data)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memoryEpisodes.all(userKey),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memoryEntries.all(userKey),
        });
      }
      return data;
    },
  });
}

/** Whether memory may have changed between two status reads: a run ended or notes were processed. */
function automaticRunChangedMemory(
  previous: PyAutomaticEpisodeProcessingStatus,
  next: PyAutomaticEpisodeProcessingStatus,
): boolean {
  return (
    (previous.state === "running" && next.state !== "running") ||
    next.pending_count < previous.pending_count
  );
}
