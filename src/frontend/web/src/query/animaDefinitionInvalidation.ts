import type { QueryClient } from "@tanstack/react-query";

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
    queryClient.invalidateQueries({
      queryKey: queryKeys.memoryEntries.byPath(userId, {
        animaId,
        path: "IDENTITY.md",
        type: "file",
      }),
    }),
  ]);
}
