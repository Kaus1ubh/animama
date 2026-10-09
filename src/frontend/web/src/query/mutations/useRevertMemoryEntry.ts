"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { revertMemoryEntryV1MemoryEntriesEntryIdRevertPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryEntryResponse,
  PyMemoryEntryRevertRequest,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import { invalidateAnimaDefinition } from "@/query/animaDefinitionInvalidation";

export type RevertMemoryEntryArgs = {
  entryId: string;
  body: PyMemoryEntryRevertRequest;
};

/** Reverts content/description only after the backend checks current Version. */
export function useRevertMemoryEntry() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryResponse, Error, RevertMemoryEntryArgs>({
    mutationFn: async ({ entryId, body }) => {
      const result = await revertMemoryEntryV1MemoryEntriesEntryIdRevertPost({
        client: apiClient,
        path: { entry_id: entryId },
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
      if (!userId) return;
      if (entry.anima_id && entry.aggregate_revision != null) {
        void invalidateAnimaDefinition(queryClient, userKey, entry.anima_id);
      }
      queryClient.setQueryData(
        queryKeys.memoryEntries.detail(userKey, entry.id),
        entry,
      );
      queryClient.setQueryData(
        queryKeys.memoryEntries.byPath(userKey, {
          animaId: entry.anima_id ?? null,
          path: entry.path,
          type: entry.type,
        }),
        entry,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
    onError: (error, args) => {
      if (
        !userId ||
        !(error instanceof MemoryEntryApiError) ||
        error.status !== 409
      ) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.detail(userKey, args.entryId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.versions(userKey, args.entryId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
  });
}
