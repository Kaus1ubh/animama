import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { catalogViewItem } from "@/lib/content/catalogTypes";
import { listCatalogItems } from "@/lib/content/catalogApi";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** An Appearance saved as some Avatar's portrait (`presentation.avatar_item_id`). */
export function isGeneratedAvatarPortrait(item: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  const presentation = item.metadata?.presentation;
  return (
    typeof presentation === "object" &&
    presentation !== null &&
    "avatar_item_id" in presentation
  );
}

export function useAppearanceImages() {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery({
    queryKey: queryKeys.appearanceImages.list(userId ?? "__anon__"),
    enabled: Boolean(userId),
    queryFn: async () =>
      (await listCatalogItems(apiClient, "appearance"))
        // Generated Avatar portraits already serve as the portrait fallback.
        .filter(
          (item) => item.source === "local" && !isGeneratedAvatarPortrait(item),
        )
        .map(catalogViewItem),
  });
}
