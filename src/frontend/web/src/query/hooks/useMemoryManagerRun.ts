"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import {
  getCurrentMemoryManagerRunV1MemoryManagerRunsCurrentGet,
  getMemoryManagerRunV1MemoryManagerRunsRunIdGet,
} from "@animama/runtime-contracts/sdk";
import type { PyMemoryManagerRunResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UseMemoryManagerRunOptions = {
  enabled?: boolean;
};

export function useCurrentMemoryManagerRun(opts?: UseMemoryManagerRunOptions) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);

  return useQuery<PyMemoryManagerRunResponse | null>({
    queryKey: queryKeys.memoryManager.current(userKey),
    enabled,
    queryFn: async () => {
      const { data } =
        await getCurrentMemoryManagerRunV1MemoryManagerRunsCurrentGet({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data ?? null;
    },
  });
}

export function useMemoryManagerRun(
  runId: string | null | undefined,
  opts?: UseMemoryManagerRunOptions,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const keyId = runId ?? "__none__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId) && Boolean(runId);

  return useQuery<PyMemoryManagerRunResponse | null>({
    queryKey: queryKeys.memoryManager.run(userKey, keyId),
    enabled,
    queryFn: async () => {
      if (!runId) return null;
      const { data } = await getMemoryManagerRunV1MemoryManagerRunsRunIdGet({
        client: apiClient,
        path: { run_id: runId },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
