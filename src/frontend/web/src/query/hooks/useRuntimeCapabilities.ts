import { useQuery } from "@tanstack/react-query";

import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";
import { useProductApiClient, useProductRuntime } from "@animama/product-ui";

/** Heartbeats are presentation state, while enqueue requests remain server guarded. */
export function useRuntimeCapabilities() {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  const runtime = useProductRuntime();
  const admitted =
    "schema_version" in runtime.capabilities
      ? (runtime.capabilities as Awaited<
          ReturnType<typeof fetchRuntimeCapabilities>
        >)
      : undefined;
  return useQuery({
    queryKey: queryKeys.runtimeCapabilities(ownerId ?? "__anon__"),
    enabled: Boolean(ownerId),
    initialData: admitted,
    // Hosted permissions belong to current admission. Polling must never widen
    // them independently; local worker heartbeat state retains its existing query.
    select: (data) => (admitted?.runtime_kind === "hosted" ? admitted : data),
    queryFn: ({ signal }) => fetchRuntimeCapabilities(apiClient, signal),
    staleTime: 5000,
    refetchInterval: (query) =>
      query.state.data?.user_file_processing.enabled ? 10_000 : false,
  });
}
