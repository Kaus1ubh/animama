"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getModelRolesV1ModelRolesGet,
  listModelConnectionPresetsV1ModelConnectionPresetsGet,
  listModelConnectionsV1ModelConnectionsGet,
} from "@animama/runtime-contracts/sdk";
import type {
  PyModelConnection,
  PyModelConnectionPreset,
  PyModelRoles,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Re-embedding progress is polled while the server reports work in flight. */
const ROLE_PROGRESS_POLL_MS = 5_000;

/**
 * Presets for new model connections. `enabled` should follow the runtime's
 * `model_configuration` capability: other compositions do not serve these routes.
 */
export function useModelConnectionPresets(enabled: boolean) {
  const ownerId = useRuntimeOwnerId();
  return useQuery<PyModelConnectionPreset[]>({
    queryKey: queryKeys.modelConfiguration.presets(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } =
        await listModelConnectionPresetsV1ModelConnectionPresetsGet({
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
  });
}

/** The built-in and owner connections with their models, including hidden rows. */
export function useModelConnections(enabled: boolean) {
  const ownerId = useRuntimeOwnerId();
  return useQuery<PyModelConnection[]>({
    queryKey: queryKeys.modelConfiguration.connections(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    queryFn: async () => {
      const { data } = await listModelConnectionsV1ModelConnectionsGet({
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

/** The row doing each role's job and the embeddings re-embedding status. */
export function useModelRoles(enabled: boolean) {
  const ownerId = useRuntimeOwnerId();
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
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
