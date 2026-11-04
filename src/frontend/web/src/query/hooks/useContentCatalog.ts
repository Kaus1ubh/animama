import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listContentCatalogV1ContentCatalogGet,
  rescanContentCatalogV1ContentRescanPost,
} from "@animama/runtime-contracts/sdk";
import type { PyContentCatalog } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { refreshContentCatalogViews } from "@/query/contentCatalogInvalidation";
import { queryKeys } from "@/query/keys";
import { useRuntimeCapabilities } from "./useRuntimeCapabilities";

/**
 * Read the operator-inspectable Included/Local catalog for the signed-in user.
 *
 * Content Health polls it, so each poll revalidates by ETag and an unchanged
 * catalog costs a 304. The first read only establishes the baseline: the views
 * mounted beside it have just loaded the same catalog state themselves.
 */
export function useContentCatalog() {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const queryClient = useQueryClient();
  return useQuery<PyContentCatalog>({
    queryKey: queryKeys.content.catalog(userId ?? "__anon__"),
    enabled: Boolean(userId),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const catalog = (
        await listContentCatalogV1ContentCatalogGet({
          client: apiClient,
          signal,
          cache: "no-cache",
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data;
      const previous = userId
        ? queryClient.getQueryData<PyContentCatalog>(
            queryKeys.content.catalog(userId),
          )
        : undefined;
      if (userId && previous) {
        await refreshContentCatalogViews(
          queryClient,
          userId,
          previous,
          catalog,
        );
      }
      return catalog;
    },
  });
}

/** Ask Animama to reconcile manual host edits, then replace the cached catalog. */
export function useRescanContent() {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const queryClient = useQueryClient();
  const { data: capabilities } = useRuntimeCapabilities();
  return useMutation({
    onMutate: async () => {
      if (userId) {
        await queryClient.cancelQueries({
          queryKey: queryKeys.content.catalog(userId),
        });
      }
    },
    mutationFn: async () => {
      if (capabilities?.local_filesystem_administration !== true)
        throw new Error("Host file scanning is managed by the operator.");
      return (
        await rescanContentCatalogV1ContentRescanPost({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data;
    },
    onSuccess: async (result) => {
      if (!userId) return;
      const previous = queryClient.getQueryData<PyContentCatalog>(
        queryKeys.content.catalog(userId),
      );
      queryClient.setQueryData(
        queryKeys.content.catalog(userId),
        result.catalog,
      );
      await refreshContentCatalogViews(
        queryClient,
        userId,
        previous,
        result.catalog,
      );
    },
  });
}
