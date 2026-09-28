"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { appendMemoryManagerMessageV1MemoryManagerRunsRunIdMessagesPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerMessageCreateRequest,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import {
  invalidateApprovedIdentityDefinitions,
  publishMemoryManagerSnapshot,
} from "@/query/mutations/memoryManagerMutationCache";

export type AppendMemoryManagerMessageArgs = {
  runId: string;
  body: PyMemoryManagerMessageCreateRequest;
};

export function useAppendMemoryManagerMessage() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerRunResponse,
    Error,
    AppendMemoryManagerMessageArgs
  >({
    mutationFn: async ({ runId, body }) => {
      const result =
        await appendMemoryManagerMessageV1MemoryManagerRunsRunIdMessagesPost({
          path: { run_id: runId },
          body,
          responseValidator: undefined,
          throwOnError: false,
        });
      if (result.error !== undefined) {
        throw new MemoryManagerApiError(result.response.status, result.error);
      }
      return result.data;
    },
    onSuccess: (snapshot, args) => {
      if (!userId) return;
      publishMemoryManagerSnapshot(queryClient, userKey, snapshot);
      if (args.body.auto_approve_diffs) {
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
