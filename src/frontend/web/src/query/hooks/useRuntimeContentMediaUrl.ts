import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import {
  fetchPrivateRuntimeContentBlob,
  runtimeContentDeliveryUrl,
  runtimeContentRequiresPrivateFetch,
} from "@/lib/runtime-content/runtimeContentDelivery";

/** Produce a browser-safe image URL, using a gateway-fetched Blob for private files. */
export function useRuntimeContentMediaUrl(
  entry: RuntimeCatalogEntry | null | undefined,
) {
  const logicalUrl = runtimeContentDeliveryUrl(entry);
  const authorized = runtimeContentRequiresPrivateFetch(entry);
  const blobQuery = useQuery<Blob>({
    queryKey: [
      "runtime-asset-media",
      entry?.content_revision ?? "__none__",
      logicalUrl ?? "__none__",
    ],
    enabled: Boolean(entry && logicalUrl && authorized),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => {
      if (!entry || !logicalUrl) {
        throw new Error("A runtime image is required");
      }
      return fetchPrivateRuntimeContentBlob(entry, logicalUrl);
    },
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blobQuery.data) {
      setObjectUrl(null);
      return;
    }
    const next = URL.createObjectURL(blobQuery.data);
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blobQuery.data]);
  return {
    url: authorized ? objectUrl : logicalUrl,
    isPending: authorized && blobQuery.isPending,
    isError: authorized && blobQuery.isError,
    error: blobQuery.error,
  };
}
