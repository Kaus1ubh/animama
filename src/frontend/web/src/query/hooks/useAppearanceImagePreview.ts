"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { createAnimaPresentationObjectUrl } from "@/lib/anima/animaPresentationImage";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { previewCatalogItem } from "@/lib/content/catalogApi";
import {
  contentPreviewPrimaryFile,
  fetchContentPreviewFile,
} from "@/lib/content/contentPreview";
import { queryKeys } from "@/query/keys";

/** Resolve one exact catalog Appearance to a mount-owned browser image URL. */
export function useAppearanceImagePreview(
  itemId: string | null | undefined,
  use: "profile" | "background",
  options: { enabled?: boolean } = {},
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const previewQuery = useQuery<Blob>({
    queryKey: queryKeys.appearanceImages.preview(
      userId ?? "__anon__",
      itemId ?? "__none__",
      use,
    ),
    enabled: Boolean(userId && itemId && (options.enabled ?? true)),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      if (!itemId) throw new Error("An Appearance item is required.");
      const preview = await previewCatalogItem(
        apiClient,
        itemId,
        undefined,
        "appearance",
      );
      const file = contentPreviewPrimaryFile(preview, "image");
      if (!file) throw new Error("The Appearance preview has no image file.");
      const response = await fetchContentPreviewFile(preview, file);
      if (!response.ok) {
        throw new Error(
          `Appearance preview failed with HTTP ${response.status}.`,
        );
      }
      return response.blob();
    },
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewQuery.data) {
      setObjectUrl(null);
      return;
    }
    const lease = createAnimaPresentationObjectUrl(previewQuery.data);
    setObjectUrl(lease.url);
    return lease.release;
  }, [previewQuery.data]);

  return {
    url: objectUrl,
    isPending: previewQuery.isPending,
    isError: previewQuery.isError,
    error: previewQuery.error,
  };
}
