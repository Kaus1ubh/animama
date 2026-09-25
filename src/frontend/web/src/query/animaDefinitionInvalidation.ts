import type { QueryClient } from "@tanstack/react-query";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";

import { queryKeys } from "@/query/keys";

/** Refresh revision-bearing definition views without remounting live runtime. */
export async function invalidateAnimaDefinition(
  queryClient: QueryClient,
  userId: string,
  animaId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.animas.detail(userId, animaId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.animas.list(userId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.animaLoadouts.detail(userId, animaId),
    }),
    // The Memory workspace labels identity folders with the current name.
    queryClient.invalidateQueries({
      queryKey: queryKeys.memoryEntries.animaIdentities(userId),
    }),
    // It reads identity detail by entry ID, whose revision guard just moved.
    queryClient.invalidateQueries({
      queryKey: queryKeys.memoryEntries.details(userId),
      predicate: (query) =>
        (query.state.data as PyMemoryEntryResponse | undefined)?.anima_id ===
        animaId,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.memoryEntries.byPath(userId, {
        animaId,
        path: "IDENTITY.md",
        type: "file",
      }),
    }),
  ]);
}
