"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { repairAnimaMemoriesV1MemoryAnimaMemoriesAnimaIdRepairPost } from "@animama/runtime-contracts/sdk";
import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";

export type RepairAnimaMemoriesArgs = { animaId: string };

/**
 * Recreates an owned Anima's missing `MEMORIES.md` from its template. The
 * backend leaves an existing file unchanged, so a repeated repair is harmless.
 * Settles only after the Anima listing refetches, so the folder shows the
 * repaired file (or drops a deleted Anima) before the caller reports success.
 */
export function useRepairAnimaMemories() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryHeader, Error, RepairAnimaMemoriesArgs>({
    mutationFn: async ({ animaId }) => {
      const result =
        await repairAnimaMemoriesV1MemoryAnimaMemoriesAnimaIdRepairPost({
          client: apiClient,
          path: { anima_id: animaId },
          responseValidator: undefined,
          throwOnError: false,
        });
      if (result.error !== undefined) {
        throw sdkResultError(
          result,
          (status, error) => new MemoryEntryApiError(status, error),
        );
      }
      return result.data;
    },
    onSettled: () => {
      if (!userId) return;
      return queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.animaIdentities(userKey),
      });
    },
  });
}
