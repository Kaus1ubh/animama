"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createMemoryEntryV1MemoryEntriesPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryEntryCreateRequest,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import { invalidateAnimaDefinition } from "@/query/animaDefinitionInvalidation";

export type CreateMemoryEntryArgs = {
  body: PyMemoryEntryCreateRequest;
};

export function useCreateMemoryEntry() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryResponse, Error, CreateMemoryEntryArgs>({
    mutationFn: async ({ body }) => {
      const result = await createMemoryEntryV1MemoryEntriesPost({
        client: apiClient,
        body,
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
    onSuccess: (entry) => {
      if (userId && entry.anima_id && entry.aggregate_revision != null) {
        void invalidateAnimaDefinition(queryClient, userKey, entry.anima_id);
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
