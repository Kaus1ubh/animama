"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { completeMemoryManagerRunV1MemoryManagerRunsRunIdCompletePost } from "@animama/runtime-contracts/sdk";
import type { PyMemoryManagerRunResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";

export type CompleteMemoryManagerRunArgs = {
  runId: string;
};

/** Completes an owned memory-manager run after pending approvals are resolved. */
export function useCompleteMemoryManagerRun() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerRunResponse,
    Error,
    CompleteMemoryManagerRunArgs
  >({
    mutationFn: async ({ runId }) => {
      const result =
        await completeMemoryManagerRunV1MemoryManagerRunsRunIdCompletePost({
          client: apiClient,
          path: { run_id: runId },
          responseValidator: undefined,
          throwOnError: false,
        });
      if (result.error !== undefined) {
        throw new MemoryManagerApiError(result.response.status, result.error);
      }
      return result.data;
    },
    onSuccess: (snapshot) => {
      if (!userId) return;
      queryClient.setQueryData(
        queryKeys.memoryManager.run(userKey, snapshot.run.id),
        snapshot,
      );
      queryClient.setQueryData<PyMemoryManagerRunResponse | null>(
        queryKeys.memoryManager.current(userKey),
        (current) =>
          current?.run.id === snapshot.run.id ? null : (current ?? null),
      );
    },
  });
}
