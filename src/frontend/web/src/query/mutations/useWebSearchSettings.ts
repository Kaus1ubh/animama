import { useProductApiClient } from "@animama/product-ui";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  clearWebSearchSettingsV1WebSearchSettingsDelete,
  testWebSearchSettingsV1WebSearchSettingsTestPost,
  updateWebSearchSettingsV1WebSearchSettingsPut,
} from "@animama/runtime-contracts/sdk";
import type {
  PyWebSearchSettings,
  PyWebSearchSettingsRequest,
  PyWebSearchTestResult,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/**
 * Refresh the settings and the runtime capability, which tells the model
 * selector whether tool-capable models can search.
 */
function useInvalidateWebSearch() {
  const queryClient = useQueryClient();
  const ownerKey = useRuntimeCacheKey() ?? "__anon__";
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.webSearchSettings(ownerKey),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeCapabilities(ownerKey),
      }),
    ]);
  }, [ownerKey, queryClient]);
}

export function useUpdateWebSearchSettings() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateWebSearch();
  return useMutation<PyWebSearchSettings, unknown, PyWebSearchSettingsRequest>({
    mutationFn: async (body) => {
      const { data } = await updateWebSearchSettingsV1WebSearchSettingsPut({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSettled: invalidate,
  });
}

/** Turn application web search off by removing the backend. */
export function useClearWebSearchSettings() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateWebSearch();
  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      await clearWebSearchSettingsV1WebSearchSettingsDelete({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
    },
    onSettled: invalidate,
  });
}

/** Send one test query to a draft backend, or to the saved one without a body. */
export function useTestWebSearchSettings() {
  const apiClient = useProductApiClient();

  return useMutation<
    PyWebSearchTestResult,
    unknown,
    PyWebSearchSettingsRequest | null
  >({
    mutationFn: async (body) => {
      const { data } = await testWebSearchSettingsV1WebSearchSettingsTestPost({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
