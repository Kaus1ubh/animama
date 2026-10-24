"use client";

import type { Client } from "@animama/runtime-contracts/sdk";
import { useProductApiClient } from "@animama/product-ui";

import { useCallback } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

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
import { matchesContentName } from "@/lib/content/librarySearch";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import type { ContentOrigin } from "./useEffects";
import { selectPageItems } from "./selectPageItems";
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
  source: "included" | "local" | undefined,
  origin: ContentOrigin,
): boolean {
  return (
    origin === "all" ||
    (origin === "builtin" ? source === "included" : source === "local")
  );
}

/** Every Gesture or Reaction the caller can see, sorted by name. */
async function actionPage<T extends PyGesture | PyReaction>(
  apiClient: Client,
  kind: "gesture" | "reaction",
): Promise<PyContentPage<T>> {
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
  const rows = response.data.items.map(
    (item) => typedCatalogViewItem(item) as T,
  );
  rows.sort((left, right) => compareDisplayText(left.name, right.name));
  return {
    items: rows,
    next_cursor: null,
    query: {},
  } as PyContentPage<T>;
}

const keepEveryKind = () => true;

/** Keep one caller's origin and search over a cached full action list. */
function useActionSelection<Page extends PyContentPage<PyGesture | PyReaction>>(
  input: ActionListInput,
  keepKind: (item: Page["items"][number]) => boolean = keepEveryKind,
) {
  const origin = input.origin ?? "all";
  const query = input.query ?? "";
  return useCallback(
    (data: InfiniteData<Page>) =>
      selectPageItems<Page["items"][number], Page>(
        data,
        (item) =>
          visibleByOrigin(item.catalog_source, origin) &&
          matchesContentName(item.name, query) &&
          keepKind(item),
      ),
    [origin, query, keepKind],
  );
}

/** Gestures for one caller; the full list is fetched once and filtered locally. */
export function useGestures(input: GestureListInput = {}) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const implementationKind = input.implementationKind;
  const keepKind = useCallback(
    (item: PyGesture) =>
      !implementationKind || item.implementation_kind === implementationKind,
    [implementationKind],
  );
  const select = useActionSelection<PyGesturePage>(input, keepKind);
  return useInfiniteQuery<
    PyGesturePage,
    Error,
    InfiniteData<PyGesturePage>,
    readonly unknown[],
    string | null
  >({
    queryKey: queryKeys.gestures.list(userKey, "", "all"),
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null,
    queryFn: async () =>
      (await actionPage<PyGesture>(apiClient, "gesture")) as PyGesturePage,
    getNextPageParam: () => undefined,
    select,
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

/** Reactions for one caller; the full list is fetched once and filtered locally. */
export function useReactions(input: ActionListInput = {}) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const select = useActionSelection<PyReactionPage>(input);
  return useInfiniteQuery<
    PyReactionPage,
    Error,
    InfiniteData<PyReactionPage>,
    readonly unknown[],
    string | null
  >({
    queryKey: queryKeys.reactions.list(userKey, "", "all"),
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null,
    queryFn: async () =>
      (await actionPage<PyReaction>(apiClient, "reaction")) as PyReactionPage,
    getNextPageParam: () => undefined,
    select,
  });
}
