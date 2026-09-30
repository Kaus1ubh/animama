"use client";

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
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/**
 * Refresh the settings and the runtime capability, which tells the model
 * selector whether tool-capable models can search.
 */
function useInvalidateWebSearch() {
  const queryClient = useQueryClient();
  const ownerKey = useRuntimeOwnerId() ?? "__anon__";
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
  const invalidate = useInvalidateWebSearch();
  return useMutation<PyWebSearchSettings, unknown, PyWebSearchSettingsRequest>({
    mutationFn: async (body) => {
      const { data } = await updateWebSearchSettingsV1WebSearchSettingsPut({
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
  const invalidate = useInvalidateWebSearch();
  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      await clearWebSearchSettingsV1WebSearchSettingsDelete({
        responseValidator: undefined,
        throwOnError: true,
      });
    },
    onSettled: invalidate,
  });
}

/** Send one test query to a draft backend, or to the saved one without a body. */
export function useTestWebSearchSettings() {
  return useMutation<
    PyWebSearchTestResult,
    unknown,
    PyWebSearchSettingsRequest | null
  >({
    mutationFn: async (body) => {
      const { data } = await testWebSearchSettingsV1WebSearchSettingsTestPost({
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
