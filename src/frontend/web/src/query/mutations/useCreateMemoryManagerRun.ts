import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createMemoryManagerRunV1MemoryManagerRunsPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerRunCreateRequest,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import {
  invalidateApprovedIdentityDefinitions,
  publishMemoryManagerSnapshot,
} from "@/query/mutations/memoryManagerMutationCache";

export type CreateMemoryManagerRunArgs = {
  body?: PyMemoryManagerRunCreateRequest;
};

export function useCreateMemoryManagerRun() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerRunResponse,
    Error,
    CreateMemoryManagerRunArgs | undefined
  >({
    mutationFn: async (args) => {
      const result = await createMemoryManagerRunV1MemoryManagerRunsPost({
        client: apiClient,
        body: args?.body ?? { metadata: {} },
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
      if (args?.body?.auto_approve_diffs) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memoryEntries.all(userKey),
        });
        void invalidateApprovedIdentityDefinitions(
          queryClient,
          userKey,
          snapshot.approvals ?? [],
        );
      }
    },
  });
}
