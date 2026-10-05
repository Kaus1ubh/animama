"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchMemoryEntryV1MemoryEntriesEntryIdPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryEntryHeader,
  PyMemoryEntryResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { memoryMovePaths } from "@/lib/memory-entries/workspace-moves";
import { queryKeys } from "@/query/keys";

export type MoveMemoryEntryArgs = {
  source: PyMemoryEntryHeader;
  destinationParentId?: string | null;
  name?: string;
  affectedEntries: PyMemoryEntryHeader[];
};

/** Sends a move/rename patch and retires caches addressed by old paths. */
export function useMoveMemoryEntry() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyMemoryEntryResponse, Error, MoveMemoryEntryArgs>({
    mutationFn: async ({ source, destinationParentId, name }) => {
      if (destinationParentId === undefined && name === undefined) {
        throw new Error("A memory relocation requires a parent or name change");
      }
      const result = await patchMemoryEntryV1MemoryEntriesEntryIdPatch({
        client: apiClient,
        path: { entry_id: source.id },
        body: {
          expected_version: source.version,
          ...(destinationParentId !== undefined
            ? { parent_id: destinationParentId }
            : {}),
          ...(name !== undefined ? { name } : {}),
        },
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined) {
        throw new MemoryEntryApiError(result.response.status, result.error);
      }
      return result.data;
    },
    onSuccess: (moved, { source, affectedEntries }) => {
      if (!userId) return;
      for (const path of memoryMovePaths(
        affectedEntries,
        source.path,
        moved.path,
      )) {
        queryClient.removeQueries({
          queryKey: queryKeys.memoryEntries.byPath(userKey, {
            animaId: source.anima_id ?? null,
            path: path.oldPath,
            type: path.type,
          }),
          exact: true,
        });
        queryClient.removeQueries({
          queryKey: queryKeys.memoryEntries.byPath(userKey, {
            animaId: source.anima_id ?? null,
            path: path.newPath,
            type: path.type,
          }),
          exact: true,
        });
      }
      queryClient.setQueryData(
        queryKeys.memoryEntries.detail(userKey, moved.id),
        moved,
      );
      queryClient.setQueryData(
        queryKeys.memoryEntries.byPath(userKey, {
          animaId: moved.anima_id ?? null,
          path: moved.path,
          type: moved.type,
        }),
        moved,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
  });
}
