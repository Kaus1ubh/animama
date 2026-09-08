"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { getIdleStyle, listIdleStyles } from "@animama/runtime-contracts/sdk";
import type { PyIdleStyle, PyIdleStylePage } from "@/lib/content/catalogTypes";
import { typedCatalogViewItem } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

type ListInput = {
  query?: string;
  origin?: "all" | "builtin" | "owned";
  sort?: "relevance" | "updated" | "name";
};

export function useIdleStyles(input: ListInput = {}) {
  const userId = useRuntimeOwnerId();
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? "name";
  return useInfiniteQuery<PyIdleStylePage>({
    queryKey: queryKeys.idleStyles.list(
      userId ?? "__anon__",
      query,
      origin,
      sort,
    ),
    enabled: Boolean(userId),
    initialPageParam: null as string | null,
    queryFn: async () => {
      const needle = query.trim().toLocaleLowerCase();
      const response = await listIdleStyles({
        responseValidator: undefined,
        throwOnError: true,
      });
      const items = response.data.items
        .filter(
          (item) =>
            (origin === "all" ||
              (origin === "builtin"
                ? item.source === "included"
                : item.source === "local")) &&
            (!needle || item.name.toLocaleLowerCase().includes(needle)),
        )
        .map((item) => typedCatalogViewItem(item) as PyIdleStyle);
      return { items, next_cursor: null, query: {} } as PyIdleStylePage;
    },
    getNextPageParam: () => undefined,
  });
}

export function useIdleStyle(itemId: string | null) {
  const userId = useRuntimeOwnerId();
  return useQuery({
    queryKey: queryKeys.idleStyles.detail(
      userId ?? "__anon__",
      itemId ?? "__none__",
    ),
    enabled: Boolean(userId && itemId),
    queryFn: async () =>
      typedCatalogViewItem(
        (
          await getIdleStyle({
            path: { item_id: itemId! },
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      ) as PyIdleStyle,
  });
}
