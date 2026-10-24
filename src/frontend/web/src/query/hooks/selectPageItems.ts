import type { InfiniteData } from "@tanstack/react-query";

/**
 * Filter each page of a cached full content list for one caller. Lists cache
 * the unfiltered family under one key, so a caller's search, origin or kind
 * never starts another request.
 */
export function selectPageItems<Item, Page extends { items: Item[] }>(
  data: InfiniteData<Page>,
  keep: (item: Item) => boolean,
): InfiniteData<Page> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter(keep),
    })),
  };
}
