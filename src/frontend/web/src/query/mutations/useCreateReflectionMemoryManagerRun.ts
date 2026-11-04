import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createReflectionMemoryManagerRunV1MemoryManagerRunsReflectPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerReflectionRunCreateRequest,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import { publishMemoryManagerSnapshot } from "@/query/mutations/memoryManagerMutationCache";

export type CreateReflectionMemoryManagerRunArgs = {
  body: PyMemoryManagerReflectionRunCreateRequest;
};

/**
 * Starts a Reflection over one Anima's uncovered chat turns. The backend owns
 * the turn batch; a `409` (nothing to reflect, a pending approval, a missing
 * `MEMORIES.md` or a concurrent run) creates no run and leaves the open one.
 */
export function useCreateReflectionMemoryManagerRun() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerRunResponse,
    Error,
    CreateReflectionMemoryManagerRunArgs
  >({
    mutationFn: async ({ body }) => {
      const result =
        await createReflectionMemoryManagerRunV1MemoryManagerRunsReflectPost({
          client: apiClient,
          body,
          responseValidator: undefined,
          throwOnError: false,
        });
      if (result.error !== undefined) {
        throw sdkResultError(
          result,
          (status, error) => new MemoryManagerApiError(status, error),
        );
      }
      return result.data;
    },
    onSuccess: (snapshot, args) => {
      if (!userId) return;
      publishMemoryManagerSnapshot(queryClient, userKey, snapshot);
      // Auto approve may already have committed the MEMORIES.md change.
      if (args.body.auto_approve_diffs) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memoryEntries.all(userKey),
        });
      }
    },
    onError: (error) => {
      if (!userId || !(error instanceof MemoryManagerApiError)) return;
      if (error.status !== 404 && error.status !== 409) return;
      // The page was stale: a run is waiting for approval, the Anima was
      // deleted or its MEMORIES.md needs repair. Refetching updates the Anima
      // folders and, when no conversation is shown, recovers a pending approval
      // through the current-run lookup; a shown conversation stays in place.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryManager.all(userKey),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.animaIdentities(userKey),
      });
    },
  });
}
