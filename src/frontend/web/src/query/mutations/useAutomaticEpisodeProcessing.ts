import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAutomaticEpisodeProcessingV1MemoryAutomaticProcessingPut } from "@animama/runtime-contracts/sdk";
import type { PyAutomaticEpisodeProcessingStatus } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Store the threshold (0 for Off, or 5–50 pending notes); the response is the new status. */
export function useUpdateAutomaticEpisodeProcessing() {
  const apiClient = useProductApiClient();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.automaticEpisodeProcessing(
    useRuntimeCacheKey() ?? "__anon__",
  );
  return useMutation<PyAutomaticEpisodeProcessingStatus, unknown, number>({
    mutationFn: async (threshold) => {
      const { data } =
        await updateAutomaticEpisodeProcessingV1MemoryAutomaticProcessingPut({
          client: apiClient,
          body: { threshold },
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSuccess: (status) => queryClient.setQueryData(queryKey, status),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
