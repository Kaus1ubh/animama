"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { catalogViewItem } from "@/lib/content/catalogTypes";
import { listCatalogItems } from "@/lib/content/catalogApi";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export function useAppearanceImages() {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery({
    queryKey: queryKeys.appearanceImages.list(userId ?? "__anon__"),
    enabled: Boolean(userId),
    queryFn: async () =>
      (await listCatalogItems(apiClient, "appearance"))
        .filter((item) => item.source === "local")
        .map(catalogViewItem),
  });
}
