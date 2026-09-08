"use client";

import { useQuery } from "@tanstack/react-query";

import { catalogViewItem } from "@/lib/content/catalogTypes";
import { listCatalogItems } from "@/lib/content/catalogApi";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export function useAppearanceImages() {
  const userId = useRuntimeOwnerId();
  return useQuery({
    queryKey: queryKeys.appearanceImages.list(userId ?? "__anon__"),
    enabled: Boolean(userId),
    queryFn: async () =>
      (await listCatalogItems("appearance"))
        .filter((item) => item.source === "local")
        .map(catalogViewItem),
  });
}
