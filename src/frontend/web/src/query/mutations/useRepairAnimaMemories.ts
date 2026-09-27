"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { repairAnimaMemoriesV1MemoryAnimaMemoriesAnimaIdRepairPost } from "@animama/runtime-contracts/sdk";
import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";

export type RepairAnimaMemoriesArgs = { animaId: string };

/**
 * Recreates an owned Anima's missing `MEMORIES.md` from its template. The
 * backend leaves an existing file unchanged, so a repeated repair is harmless.
 * Settles only after the Anima listing refetches, so the folder shows the
 * repaired file (or drops a deleted Anima) before the caller reports success.
 */
export function useRepairAnimaMemories() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryHeader, Error, RepairAnimaMemoriesArgs>({
    mutationFn: async ({ animaId }) => {
      const result =
        await repairAnimaMemoriesV1MemoryAnimaMemoriesAnimaIdRepairPost({
          path: { anima_id: animaId },
          responseValidator: undefined,
          throwOnError: false,
        });
      if (result.error !== undefined) {
        throw new MemoryEntryApiError(result.response.status, result.error);
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
