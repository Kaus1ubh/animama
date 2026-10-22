import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/query/keys";

/** Refresh Avatar metadata and every Anima surface that projects its portrait. */
export async function invalidateAvatarPortraitPresentation(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.avatars.all(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.animas.all(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.avatarCatalog.all(userId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.animaCreation.list(userId, "avatar"),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.content.catalog(userId),
    }),
  ]);
}
