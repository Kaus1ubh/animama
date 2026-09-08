"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteMemoryEntryV1MemoryEntriesEntryIdDelete } from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";

export type DeleteMemoryEntryArgs = {
  entryId: string;
  expectedVersion: number;
  recursive?: boolean;
};

export function useDeleteMemoryEntry() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<void, Error, DeleteMemoryEntryArgs>({
    mutationFn: async ({ entryId, expectedVersion, recursive }) => {
      const result = await deleteMemoryEntryV1MemoryEntriesEntryIdDelete({
        path: { entry_id: entryId },
        query: {
          expected_version: expectedVersion,
          recursive: recursive ?? false,
        },
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw new MemoryEntryApiError(result.response.status, result.error);
      }
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
  });
}
