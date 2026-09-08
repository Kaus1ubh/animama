"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listContentCatalogV1ContentCatalogGet,
  rescanContentCatalogV1ContentRescanPost,
} from "@animama/runtime-contracts/sdk";
import type { PyContentCatalog } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Read the operator-inspectable Included/Local catalog for the signed-in user. */
export function useContentCatalog() {
  const userId = useRuntimeOwnerId();
  return useQuery<PyContentCatalog>({
    queryKey: queryKeys.content.catalog(userId ?? "__anon__"),
    enabled: Boolean(userId),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () =>
      (
        await listContentCatalogV1ContentCatalogGet({
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  });
}

/** Ask Animama to reconcile manual host edits, then replace the cached catalog. */
export function useRescanContent() {
  const userId = useRuntimeOwnerId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await rescanContentCatalogV1ContentRescanPost({
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
    onSuccess: (result) => {
      if (!userId) return;
      queryClient.setQueryData(
        queryKeys.content.catalog(userId),
        result.catalog,
      );
    },
  });
}
