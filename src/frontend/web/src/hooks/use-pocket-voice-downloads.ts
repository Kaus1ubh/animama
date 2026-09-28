import { useCallback, useMemo } from "react";

import { createLogger } from "@/lib/logger";
import { pocketVoiceAvailability } from "@/lib/speech/pocket/voice-downloads";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { useModelAssets } from "@/query/hooks/useModelAssets";

/**
 * Install state of downloadable Pocket voices, and a way to start an install.
 * Installs run in the backend downloader (single-flight per asset), so repeated
 * requests for the same voice are harmless; progress polls only while one runs.
 */
export function usePocketVoiceDownloads({ enabled }: { enabled: boolean }) {
  const assets = useModelAssets({ enabled });
  const action = useModelAssetAction();
  const { mutate } = action;
  const availability = useMemo(
    () => pocketVoiceAvailability(assets.data?.assets),
    [assets.data],
  );
  const logger = useMemo(() => createLogger("PocketVoiceDownloads"), []);
  const install = useCallback(
    (assetId: string) =>
      mutate(
        { action: "install", assetId },
        {
          // The next reply or pick retries; the request itself only logs.
          onError: (error) =>
            logger.warn("Install", "Pocket voice install request failed", {
              assetId,
              error: error.message,
            }),
        },
      ),
    [logger, mutate],
  );
  const remove = useCallback(
    (assetId: string) => mutate({ action: "remove", assetId }),
    [mutate],
  );
  const busy = action.busy || action.isPending;
  const blockedReason = action.blockedReason;
  const retryAssetIds = assets.retryAssetIds;
  const error = action.isError
    ? "The voice download change could not finish. Retry in a moment."
    : assets.isError
      ? "Voice downloads are unavailable. Reopen the voice browser to retry."
      : null;
  return useMemo(
    () => ({
      availability,
      install,
      remove,
      busy,
      blockedReason,
      retryAssetIds,
      error,
    }),
    [availability, install, remove, busy, blockedReason, retryAssetIds, error],
  );
}
