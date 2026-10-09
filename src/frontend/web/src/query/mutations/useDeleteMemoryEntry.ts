"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteMemoryEntryV1MemoryEntriesEntryIdDelete } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";

export type DeleteMemoryEntryArgs = {
  entryId: string;
  expectedVersion: number;
  recursive?: boolean;
};

export function useDeleteMemoryEntry() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<void, Error, DeleteMemoryEntryArgs>({
    mutationFn: async ({ entryId, expectedVersion, recursive }) => {
      const result = await deleteMemoryEntryV1MemoryEntriesEntryIdDelete({
        client: apiClient,
        path: { entry_id: entryId },
        query: {
          expected_version: expectedVersion,
          recursive: recursive ?? false,
        },
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw sdkResultError(
          result,
          (status, error) => new MemoryEntryApiError(status, error),
        );
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
