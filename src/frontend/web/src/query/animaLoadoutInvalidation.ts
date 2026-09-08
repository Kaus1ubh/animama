import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/query/keys";
import { invalidateAnimaDefinition } from "./animaDefinitionInvalidation";

/** Invalidate both mutable Loadout state and its immutable runtime projection. */
export async function invalidateAnimaLoadoutAndRuntime(
  queryClient: QueryClient,
  userId: string,
  animaId: string,
): Promise<void> {
  await Promise.all([
    invalidateAnimaDefinition(queryClient, userId, animaId),
    queryClient.invalidateQueries({
      queryKey: queryKeys.animaLoadouts.runtime(userId, animaId),
    }),
  ]);
}
