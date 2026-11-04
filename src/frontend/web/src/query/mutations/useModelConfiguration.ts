import { useProductApiClient } from "@animama/product-ui";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  addOwnerModelV1ModelConnectionsConnectionIdModelsPost,
  createModelConnectionV1ModelConnectionsPost,
  detectModelConnectionPresetV1ModelConnectionPresetsPresetIdDetectPost,
  listAvailableModelsV1ModelConnectionsConnectionIdAvailableModelsGet,
  probeModelV1ModelConnectionsConnectionIdProbePost,
  removeModelConnectionV1ModelConnectionsConnectionIdDelete,
  removeModelV1ModelProvidersModelProviderIdDelete,
  updateModelConnectionV1ModelConnectionsConnectionIdPatch,
  updateModelV1ModelProvidersModelProviderIdPatch,
} from "@animama/runtime-contracts/sdk";
import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelConnectionRequest,
  PyModelConnectionUpdate,
  PyModelProbeReport,
  PyModelProbeRequest,
  PyModelRemovalResult,
  PyOwnerModelPatch,
  PyOwnerModelRequest,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/**
 * Refresh everything a connection or model change can affect: the Models
 * section, chat model lists, role assignments the server may have cleared and
 * Anima chat profiles that now point at an unavailable model.
 */
function useInvalidateModelConfiguration() {
  const queryClient = useQueryClient();
  const ownerKey = useRuntimeCacheKey() ?? "__anon__";
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.modelConfiguration.all(ownerKey),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.modelProviders.all(ownerKey),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.all(ownerKey),
      }),
    ]);
  }, [ownerKey, queryClient]);
}

export function useCreateModelConnection() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<PyModelConnection, unknown, PyModelConnectionRequest>({
    mutationFn: async (body) => {
      const { data } = await createModelConnectionV1ModelConnectionsPost({
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

export function useUpdateModelConnection() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<
    PyModelConnection,
    unknown,
    { connectionId: string; body: PyModelConnectionUpdate }
  >({
    mutationFn: async ({ connectionId, body }) => {
      const { data } =
        await updateModelConnectionV1ModelConnectionsConnectionIdPatch({
          client: apiClient,
          path: { connection_id: connectionId },
          body,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSettled: invalidate,
  });
}

/**
 * Remove a connection. Without `confirm`, the server refuses with
 * `model_in_use` and reports the Animas and roles that use its models.
 */
export function useRemoveModelConnection() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<
    PyModelRemovalResult,
    unknown,
    { connectionId: string; confirm: boolean }
  >({
    mutationFn: async ({ connectionId, confirm }) => {
      const { data } =
        await removeModelConnectionV1ModelConnectionsConnectionIdDelete({
          client: apiClient,
          path: { connection_id: connectionId },
          query: { confirm },
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSettled: invalidate,
  });
}

export function useAddOwnerModel() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<
    PyConfiguredModel,
    unknown,
    { connectionId: string; body: PyOwnerModelRequest }
  >({
    mutationFn: async ({ connectionId, body }) => {
      const { data } =
        await addOwnerModelV1ModelConnectionsConnectionIdModelsPost({
          client: apiClient,
          path: { connection_id: connectionId },
          body,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSettled: invalidate,
  });
}

/** Edit an owner model, or hide or show a built-in one. */
export function useUpdateModel() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<
    PyConfiguredModel,
    unknown,
    { modelProviderId: string; body: PyOwnerModelPatch }
  >({
    mutationFn: async ({ modelProviderId, body }) => {
      const { data } = await updateModelV1ModelProvidersModelProviderIdPatch({
        client: apiClient,
        path: { model_provider_id: modelProviderId },
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSettled: invalidate,
  });
}

export function useRemoveModel() {
  const apiClient = useProductApiClient();

  const invalidate = useInvalidateModelConfiguration();
  return useMutation<
    PyModelRemovalResult,
    unknown,
    { modelProviderId: string; confirm: boolean }
  >({
    mutationFn: async ({ modelProviderId, confirm }) => {
      const { data } = await removeModelV1ModelProvidersModelProviderIdDelete({
        client: apiClient,
        path: { model_provider_id: modelProviderId },
        query: { confirm },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSettled: invalidate,
  });
}

/** Ask the connection's server which models it serves (not cached). */
export function useListAvailableModels() {
  const apiClient = useProductApiClient();

  return useMutation<string[], unknown, { connectionId: string }>({
    mutationFn: async ({ connectionId }) => {
      const { data } =
        await listAvailableModelsV1ModelConnectionsConnectionIdAvailableModelsGet(
          {
            client: apiClient,
            path: { connection_id: connectionId },
            responseValidator: undefined,
            throwOnError: true,
          },
        );
      return data.models;
    },
  });
}

/** Test a model on its connection; the report suggests capabilities. */
export function useProbeModel() {
  const apiClient = useProductApiClient();

  return useMutation<
    PyModelProbeReport,
    unknown,
    { connectionId: string; body: PyModelProbeRequest }
  >({
    mutationFn: async ({ connectionId, body }) => {
      const { data } = await probeModelV1ModelConnectionsConnectionIdProbePost({
        client: apiClient,
        path: { connection_id: connectionId },
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

/**
 * Check whether a local model server is running at its preset's default
 * address. The backend makes the request, so the address is checked from
 * where the connection will run.
 */
export function useDetectModelServer() {
  const apiClient = useProductApiClient();

  return useMutation<PyModelConnectionDetection, unknown, { presetId: string }>(
    {
      mutationFn: async ({ presetId }) => {
        const { data } =
          await detectModelConnectionPresetV1ModelConnectionPresetsPresetIdDetectPost(
            {
              client: apiClient,
              path: { preset_id: presetId },
              responseValidator: undefined,
              throwOnError: true,
            },
          );
        return data;
      },
    },
  );
}
