import { useCallback, useMemo } from "react";

import { createLogger } from "@/lib/logger";
import { pocketVoiceAvailability } from "@/lib/speech/pocket/voice-downloads";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import {
  useModelAssets,
  useOperatorManagedModelAssets,
} from "@/query/hooks/useModelAssets";

/**
 * Install state of downloadable Pocket voices, and a way to start an install.
 * Installs run in the backend downloader (single-flight per asset), so repeated
 * requests for the same voice are harmless; progress polls only while one runs.
 * Where the runtime's operator provides voices (`operatorManaged`), only
 * provisioned voices are available: `install` and `remove` request nothing.
 */
export function usePocketVoiceDownloads({ enabled }: { enabled: boolean }) {
  const assets = useModelAssets({ enabled });
  const operatorManaged = useOperatorManagedModelAssets();
  const action = useModelAssetAction();
  const { mutate } = action;
  const availability = useMemo(
    () => pocketVoiceAvailability(assets.data?.assets),
    [assets.data],
  );
  const logger = useMemo(() => createLogger("PocketVoiceDownloads"), []);
  const install = useCallback(
    (assetId: string) => {
      if (operatorManaged) return;
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
      );
    },
    [logger, mutate, operatorManaged],
  );
  const remove = useCallback(
    (assetId: string) => {
      if (operatorManaged) return;
      mutate({ action: "remove", assetId });
    },
    [mutate, operatorManaged],
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
      operatorManaged,
    }),
    [
      availability,
      install,
      remove,
      busy,
      blockedReason,
      retryAssetIds,
      error,
      operatorManaged,
    ],
  );
}
