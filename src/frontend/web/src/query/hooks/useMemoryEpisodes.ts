"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { listMemoryEpisodesV1MemoryEpisodesGet } from "@animama/runtime-contracts/sdk";
import type { PyMemoryEpisodeListResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type MemoryEpisodeStatus = "pending" | "processed";

export type UseMemoryEpisodesOptions = {
  status?: MemoryEpisodeStatus | null;
  limit?: number;
  enabled?: boolean;
};

export function useMemoryEpisodes(opts?: UseMemoryEpisodesOptions) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const status = opts?.status ?? "pending";
  const limit = opts?.limit ?? 100;
  const enabled = (opts?.enabled ?? true) && Boolean(userId);

  return useQuery<PyMemoryEpisodeListResponse>({
    queryKey: queryKeys.memoryEpisodes.list(userKey, { status, limit }),
    enabled,
    queryFn: async () => {
      const { data } = await listMemoryEpisodesV1MemoryEpisodesGet({
        client: apiClient,
        query: {
          status: status ?? undefined,
          limit,
        },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
