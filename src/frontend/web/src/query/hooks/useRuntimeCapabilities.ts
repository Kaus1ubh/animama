import { useQuery } from "@tanstack/react-query";

import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { fetchRuntimeCapabilities } from "@/query/runtime-capabilities";

/** Heartbeats are presentation state, while enqueue requests remain server guarded. */
export function useRuntimeCapabilities() {
  const ownerId = useRuntimeOwnerId();
  return useQuery({
    queryKey: queryKeys.runtimeCapabilities(ownerId ?? "__anon__"),
    enabled: Boolean(ownerId),
    queryFn: ({ signal }) => fetchRuntimeCapabilities(signal),
    staleTime: 5000,
    refetchInterval: (query) =>
      query.state.data?.user_file_processing.enabled ? 10_000 : false,
  });
}
