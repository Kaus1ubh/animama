"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { listAvatarCatalogV1AvatarCatalogGet } from "@animama/runtime-contracts/sdk";
import type { PyAvatarCatalogPage } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export function useAvatarCatalog(
  input: {
    query?: string;
    origin?: string;
    sort?: string;
    enabled?: boolean;
  } = {},
) {
  const userId = useRuntimeOwnerId();
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? (query ? "relevance" : "name");
  return useInfiniteQuery<PyAvatarCatalogPage>({
    queryKey: queryKeys.avatarCatalog.list(
      userId ?? "__anon__",
      query,
      origin,
      sort,
    ),
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null as string | null,
    queryFn: async () =>
      (
        await listAvatarCatalogV1AvatarCatalogGet({
          query: {
            q: query || undefined,
            origin: origin as never,
            sort: sort as never,
            limit: 30,
          },
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}
