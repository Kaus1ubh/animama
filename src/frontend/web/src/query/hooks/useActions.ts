"use client";

import type { Client } from "@animama/runtime-contracts/sdk";
import { useProductApiClient } from "@animama/product-ui";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  getGesture,
  getReaction,
  listGestures,
  listReactions,
} from "@animama/runtime-contracts/sdk";
import type {
  PyGesture,
  PyContentPage,
  PyGesturePage,
  PyReaction,
  PyReactionPage,
} from "@/lib/content/catalogTypes";
import { typedCatalogViewItem } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import type { ContentOrigin } from "./useEffects";
import { compareDisplayText } from "@animama/product-ui/i18n";

type ActionListInput = {
  query?: string;
  origin?: ContentOrigin;
  sort?: "relevance" | "updated" | "name";
  enabled?: boolean;
};

type GestureListInput = ActionListInput & {
  implementationKind?: "anima_clip" | "vrma";
};

function visibleByOrigin(
  source: "included" | "local",
  origin: ContentOrigin,
): boolean {
  return (
    origin === "all" ||
    (origin === "builtin" ? source === "included" : source === "local")
  );
}

function matchesQuery(name: string, description: string | null, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return (
    !needle ||
    name.toLocaleLowerCase().includes(needle) ||
    (description ?? "").toLocaleLowerCase().includes(needle)
  );
}

async function actionPage<T extends PyGesture | PyReaction>(
  apiClient: Client,
  kind: "gesture" | "reaction",
  input: ActionListInput,
): Promise<PyContentPage<T>> {
  const origin = input.origin ?? "all";
  const query = input.query ?? "";
  const response =
    kind === "gesture"
      ? await listGestures({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        })
      : await listReactions({
          client: apiClient,
          responseValidator: undefined,
          throwOnError: true,
        });
  const rows = response.data.items
    .filter(
      (item) =>
        visibleByOrigin(item.source, origin) &&
        matchesQuery(item.name, item.description ?? null, query),
    )
    .map((item) => typedCatalogViewItem(item) as T);
  rows.sort((left, right) => compareDisplayText(left.name, right.name));
  return {
    items: rows as T[],
    next_cursor: null,
    query: {},
  } as PyContentPage<T>;
}

export function useGestures(input: GestureListInput = {}) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? (query ? "relevance" : "name");
  const implementationKind = input.implementationKind ?? "all";
  return useInfiniteQuery<PyGesturePage>({
    queryKey: queryKeys.gestures.list(
      userKey,
      query,
      origin,
      sort,
      implementationKind,
    ),
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null as string | null,
    queryFn: async () => {
      const page = (await actionPage<PyGesture>(
        apiClient,
        "gesture",
        input,
      )) as PyGesturePage;
      if (input.implementationKind) {
        page.items = page.items.filter(
          (item) => item.implementation_kind === input.implementationKind,
        );
      }
      return page;
    },
    getNextPageParam: () => undefined,
  });
}

/** Read one editable or Included catalog action by its stable item identity. */
export function useAction(
  intent: "gesture" | "reaction",
  itemId: string | null,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  return useQuery<PyGesture | PyReaction>({
    queryKey:
      intent === "gesture"
        ? queryKeys.gestures.detail(userKey, itemId ?? "__none__")
        : queryKeys.reactions.detail(userKey, itemId ?? "__none__"),
    enabled: Boolean(userId && itemId),
    queryFn: async () => {
      if (intent === "gesture") {
        return typedCatalogViewItem(
          (
            await getGesture({
              client: apiClient,
              path: { item_id: itemId! },
              responseValidator: undefined,
              throwOnError: true,
            })
          ).data,
        ) as PyGesture;
      }
      return typedCatalogViewItem(
        (
          await getReaction({
            client: apiClient,
            path: { item_id: itemId! },
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      ) as PyReaction;
    },
  });
}

export function useReactions(input: ActionListInput = {}) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? (query ? "relevance" : "name");
  return useInfiniteQuery<PyReactionPage>({
    queryKey: queryKeys.reactions.list(userKey, query, origin, sort),
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null as string | null,
    queryFn: async () =>
      (await actionPage<PyReaction>(
        apiClient,
        "reaction",
        input,
      )) as PyReactionPage,
    getNextPageParam: () => undefined,
  });
}
