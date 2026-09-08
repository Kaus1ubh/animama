"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchMemoryEntryV1MemoryEntriesEntryIdPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryEntryPatchRequest,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { queryKeys } from "@/query/keys";
import { invalidateAnimaDefinition } from "@/query/animaDefinitionInvalidation";

export type PatchMemoryEntryArgs = {
  entryId: string;
  body: PyMemoryEntryPatchRequest;
};

export function usePatchMemoryEntry() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryResponse, Error, PatchMemoryEntryArgs>({
    mutationFn: async ({ entryId, body }) => {
      const result = await patchMemoryEntryV1MemoryEntriesEntryIdPatch({
        path: { entry_id: entryId },
        body,
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw new MemoryEntryApiError(result.response.status, result.error);
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
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
  });
}
