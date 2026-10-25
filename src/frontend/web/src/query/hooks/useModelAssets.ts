import { useProductApiClient } from "@animama/product-ui";
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { queryKeys } from "@/query/keys";
import {
  assetAttemptKey,
  assetAttemptStorageKey,
  installedSpeechSets,
  loadModelAssets,
  readAssetAttempts,
  retryAssetIds,
} from "@/query/model-download-coordination";

const DOWNLOAD_POLL_MS = 1000;

/**
 * Whether the runtime's operator provisions model assets (speech sets, Pocket
 * voices and the voice-cloning encoder). Installing or removing them is server
 * model installation, which belongs to local filesystem administration;
 * without that permission (hosted) the model-asset service refuses both, so
 * callers show each asset's state and never request a change.
 */
export function useOperatorManagedModelAssets(): boolean {
  return (
    useRuntimeCapabilities().data?.local_filesystem_administration !== true
  );
}

/** Manager state owns progress; attempts only distinguish Retry after a service restart. */
export function useModelAssets({ enabled = true }: { enabled?: boolean } = {}) {
  const apiClient = useProductApiClient();

  const ownerId = useRuntimeCacheKey();
  const owner = ownerId ?? "__anon__";
  const client = useQueryClient();
  const attempts = useQuery({
    queryKey: assetAttemptKey(owner),
    queryFn: () => readAssetAttempts(owner),
    initialData: () => readAssetAttempts(owner),
    staleTime: Infinity,
    enabled: Boolean(ownerId),
  });
  useEffect(() => {
    if (!ownerId) return;
    const changed = (event: StorageEvent) => {
      if (event.key === assetAttemptStorageKey(owner) || event.key === null) {
        client.setQueryData(assetAttemptKey(owner), readAssetAttempts(owner));
        // The marker only wakes reconciliation. Progress and polling still come
        // from a fresh response by the owning backend manager.
        void client.invalidateQueries({
          queryKey: queryKeys.modelAssets(owner),
          exact: true,
        });
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [client, owner, ownerId]);
  const query = useQuery({
    queryKey: queryKeys.modelAssets(owner),
    enabled: enabled && Boolean(ownerId),
    queryFn: ({ signal }) => loadModelAssets(apiClient, client, owner, signal),
    // A new view/recreated renderer must reconcile with the surviving manager.
    refetchOnMount: "always",
    refetchInterval: (query) =>
      query.state.data?.assets.some((asset) => asset.status === "downloading")
        ? DOWNLOAD_POLL_MS
        : false,
  });
  // Offline speech capabilities follow the installed Parakeet and SenseVoice
  // sets without a restart; refresh them when an install or removal settles.
  const speechSets = installedSpeechSets(query.data?.assets);
  const observedSpeechSets = useRef(speechSets);
  useEffect(() => {
    if (speechSets === undefined) return;
    const previous = observedSpeechSets.current;
    observedSpeechSets.current = speechSets;
    if (previous !== undefined && previous !== speechSets)
      void client.invalidateQueries({
        queryKey: queryKeys.runtimeCapabilities(owner),
        exact: true,
      });
  }, [client, owner, speechSets]);
  const retries = useMemo(
    () => retryAssetIds(attempts.data, query.data?.assets),
    [attempts.data, query.data?.assets],
  );
  return { ...query, retryAssetIds: retries };
}
