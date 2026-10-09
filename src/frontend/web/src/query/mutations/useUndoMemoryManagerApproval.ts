"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { undoMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdUndoPost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerApproval,
  PyMemoryManagerApprovalUndoResponse,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import {
  invalidateApprovedIdentityDefinitions,
  publishMemoryManagerApproval,
} from "@/query/mutations/memoryManagerMutationCache";

export type UndoMemoryManagerApprovalArgs = {
  approval: PyMemoryManagerApproval;
};

/** Executes backend-authoritative approval Undo without optimistic memory edits. */
export function useUndoMemoryManagerApproval() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerApprovalUndoResponse,
    Error,
    UndoMemoryManagerApprovalArgs
  >({
    mutationFn: async ({ approval }) => {
      const result =
        await undoMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdUndoPost(
          {
            client: apiClient,
            path: { approval_id: approval.id },
            responseValidator: undefined,
            throwOnError: false,
          },
        );
      if (result.error !== undefined) {
        throw sdkResultError(
          result,
          (status, error) => new MemoryManagerApiError(status, error),
        );
      }
      return result.data;
    },
    onSuccess: (result) => {
      if (!userId) return;
      publishMemoryManagerApproval(queryClient, userKey, result.approval);
      void invalidateApprovedIdentityDefinitions(queryClient, userKey, [
        result.approval,
      ]);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryManager.run(userKey, result.approval.run_id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryManager.current(userKey),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
    onError: (error) => {
      if (!userId || !(error instanceof MemoryManagerApiError)) return;
      if (error.status !== 409) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryManager.all(userKey),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
    },
  });
}
