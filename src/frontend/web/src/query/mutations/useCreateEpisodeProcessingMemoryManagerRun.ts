"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createEpisodeProcessingMemoryManagerRunV1MemoryManagerRunsProcessEpisodesPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerEpisodeProcessingRunCreateRequest,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import { publishMemoryManagerSnapshot } from "@/query/mutations/memoryManagerMutationCache";

export type CreateEpisodeProcessingMemoryManagerRunArgs = {
  body: PyMemoryManagerEpisodeProcessingRunCreateRequest;
};

/** Starts one backend-owned fixed episodic-memory review batch. */
export function useCreateEpisodeProcessingMemoryManagerRun() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerRunResponse,
    Error,
    CreateEpisodeProcessingMemoryManagerRunArgs
  >({
    mutationFn: async ({ body }) => {
      const result =
        await createEpisodeProcessingMemoryManagerRunV1MemoryManagerRunsProcessEpisodesPost(
          {
            body,
            responseValidator: undefined,
            throwOnError: false,
          },
        );
      if (result.error !== undefined) {
        throw new MemoryManagerApiError(result.response.status, result.error);
      }
      return result.data;
    },
    onSuccess: (snapshot) => {
      if (!userId) return;
      publishMemoryManagerSnapshot(queryClient, userKey, snapshot);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEpisodes.all(userKey),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
    onError: (error) => {
      if (!userId) return;
      if (error instanceof MemoryManagerApiError && error.status === 409) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memoryEpisodes.all(userKey),
        });
      }
    },
  });
}
