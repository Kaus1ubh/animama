"use client";

import { useQuery } from "@tanstack/react-query";

import { getWebSearchSettingsV1WebSearchSettingsGet } from "@animama/runtime-contracts/sdk";
import type { PyWebSearchSettings } from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/**
 * The configured web search backend, without any key value. `enabled` should
 * follow the runtime's `web_search.configuration` capability: other
 * compositions do not serve this route.
 */
export function useWebSearchSettings(enabled: boolean) {
  const ownerId = useRuntimeOwnerId();
  return useQuery<PyWebSearchSettings>({
    queryKey: queryKeys.webSearchSettings(ownerId ?? "__anon__"),
    enabled: enabled && Boolean(ownerId),
    queryFn: async () => {
      const { data } = await getWebSearchSettingsV1WebSearchSettingsGet({
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
