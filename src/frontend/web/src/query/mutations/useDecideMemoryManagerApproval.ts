import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { decideMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdDecidePost } from "@animama/runtime-contracts/sdk";
import type {
  PyMemoryManagerApproval,
  PyMemoryManagerApprovalDecisionRequest,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { queryKeys } from "@/query/keys";
import { sdkResultError } from "@/query/sdkResultError";
import {
  invalidateApprovedIdentityDefinitions,
  publishMemoryManagerApproval,
} from "@/query/mutations/memoryManagerMutationCache";

export type DecideMemoryManagerApprovalArgs = {
  approvalId: string;
  body: PyMemoryManagerApprovalDecisionRequest;
};

export function useDecideMemoryManagerApproval() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyMemoryManagerApproval,
    Error,
    DecideMemoryManagerApprovalArgs
  >({
    mutationFn: async ({ approvalId, body }) => {
      const result =
        await decideMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdDecidePost(
          {
            client: apiClient,
            path: { approval_id: approvalId },
            body,
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
    onSuccess: (approval) => {
      if (!userId) return;
      const runKey = queryKeys.memoryManager.run(userKey, approval.run_id);
      publishMemoryManagerApproval(queryClient, userKey, approval);
      void invalidateApprovedIdentityDefinitions(queryClient, userKey, [
        approval,
      ]);
      void queryClient.invalidateQueries({ queryKey: runKey });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryManager.current(userKey),
      });
      // A specialized decision can finalize episode projections even when the
      // user rejected the curated diff, so refresh both memory surfaces after
      // every authoritative decision response.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEntries.all(userKey),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memoryEpisodes.all(userKey),
      });
    },
  });
}
