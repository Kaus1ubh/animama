import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import {
  getModelRolesV1ModelRolesGet,
  listAvailableModelsV1ModelConnectionsConnectionIdAvailableModelsGet,
  listModelConnectionPresetsV1ModelConnectionPresetsGet,
  listModelConnectionsV1ModelConnectionsGet,
  listOpenrouterModelsV1ModelConnectionPresetsOpenrouterModelsGet,
} from "@animama/runtime-contracts/sdk";
import type {
  PyModelConnection,
  PyModelConnectionPreset,
  PyModelRoles,
  PyOpenRouterModel,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Re-embedding progress is polled while the server reports work in flight. */
const ROLE_PROGRESS_POLL_MS = 5_000;

/**
 * Presets for new model connections. `enabled` should follow the runtime's
 * `model_configuration` capability: other compositions do not serve these routes.
 */
export function useModelConnectionPresets(enabled: boolean) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  return useQuery<PyModelConnectionPreset[]>({
    queryKey: queryKeys.modelConfiguration.presets(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } =
        await listModelConnectionPresetsV1ModelConnectionPresetsGet({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
  });
}

/** The built-in and owner connections with their models, including hidden rows. */
export function useModelConnections(enabled: boolean) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  return useQuery<PyModelConnection[]>({
    queryKey: queryKeys.modelConfiguration.connections(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    queryFn: async () => {
      const { data } = await listModelConnectionsV1ModelConnectionsGet({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

/** The row doing each role's job and the embeddings re-embedding status. */
export function useModelRoles(enabled: boolean) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  return useQuery<PyModelRoles>({
    queryKey: queryKeys.modelConfiguration.roles(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    refetchInterval: (query) => {
      const state = query.state.data?.embeddings_refresh.state;
      return state === "re_embedding" || state === "retrying"
        ? ROLE_PROGRESS_POLL_MS
        : false;
    },
    queryFn: async () => {
      const { data } = await getModelRolesV1ModelRolesGet({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

/**
 * Whether a connection's server answers a model listing, for a Local tab
 * card's status. Uses the existing available-models route; a failure is the
 * answer, so it is not retried.
 */
export function useConnectionReachability(
  connectionId: string,
  enabled: boolean,
) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  return useQuery<string[]>({
    queryKey: queryKeys.modelConfiguration.reachability(
      ownerId ?? "__anon__",
      connectionId,
    ),
    enabled: enabled && Boolean(ownerId),
    retry: false,
    staleTime: 30_000,
    // Focusing the window should not contact every local server again.
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const { data } =
        await listAvailableModelsV1ModelConnectionsConnectionIdAvailableModelsGet(
          {
            client: apiClient,
            path: { connection_id: connectionId },
            responseValidator: undefined,
            throwOnError: true,
            signal,
          },
        );
      return data.models;
    },
  });
}

/**
 * OpenRouter's public model list for the add-model picker. The backend reads
 * it without a key and answers 502 when OpenRouter is unavailable; the picker
 * then falls back to typing the model ID.
 */
export function useOpenRouterModels(enabled: boolean) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  return useQuery<PyOpenRouterModel[]>({
    queryKey: queryKeys.modelConfiguration.openRouterModels(
      ownerId ?? "__anon__",
    ),
    enabled: enabled && Boolean(ownerId),
    retry: false,
    staleTime: 10 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const { data } =
        await listOpenrouterModelsV1ModelConnectionPresetsOpenrouterModelsGet({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
          signal,
        });
      return data.models;
    },
  });
}
