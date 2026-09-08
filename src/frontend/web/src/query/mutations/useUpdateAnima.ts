"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchAnimaV1AnimasAnimaIdPatch } from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaResponse,
  PyAnimaUpdateRequest,
} from "@/lib/content/catalogTypes";
import { queryKeys } from "../keys";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaDefinition } from "@/query/animaDefinitionInvalidation";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";

export type UpdateAnimaArgs = {
  animaId: string;
  body: PyAnimaUpdateRequest;
};

export function useUpdateAnima() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<PyAnimaResponse, Error, UpdateAnimaArgs>({
    mutationFn: async (args) => {
      const { data: updated } = await patchAnimaV1AnimasAnimaIdPatch({
        path: { anima_id: args.animaId },
        body: args.body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return updated;
    },
    onSuccess: async (updated, args) => {
      if (!userId) return;
      const detailKey = queryKeys.animas.detail(userKey, updated.id);
      queryClient.setQueryData(detailKey, updated);
      // A detail response has no list presentation. Refetch the projection and
      // every affected revision guard instead of replacing it with a partial row.
      const fields = args.body.anima ?? {};
      if ("avatar_id" in fields) {
        await invalidateAnimaLoadoutAndRuntime(
          queryClient,
          userKey,
          updated.id,
        );
      } else if ("display_name" in fields) {
        await invalidateAnimaDefinition(queryClient, userKey, updated.id);
      }
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.animas.all(userKey),
      });
    },
  });
}
