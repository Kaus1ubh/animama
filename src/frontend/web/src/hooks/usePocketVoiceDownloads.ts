import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@/lib/logger";
import { pocketVoiceAvailability } from "@/lib/speech/pocket/voice-downloads";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { modelDownloadsEnded } from "@/query/model-download-coordination";
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
 * Once downloads have ended (`downloadsEnded`), only installed voices are
 * available: `install` requests nothing, and installed voices stay removable.
 */
export function usePocketVoiceDownloads({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation("app");
  const assets = useModelAssets({ enabled });
  const operatorManaged = useOperatorManagedModelAssets();
  const downloadsEnded = modelDownloadsEnded(assets.data);
  const action = useModelAssetAction();
  const { mutate } = action;
  const availability = useMemo(
    () => pocketVoiceAvailability(assets.data?.assets),
    [assets.data],
  );
  const logger = useMemo(() => createLogger("PocketVoiceDownloads"), []);
  const install = useCallback(
    (assetId: string) => {
      if (operatorManaged || downloadsEnded) return;
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
    [downloadsEnded, logger, mutate, operatorManaged],
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
    ? t("voiceDownloads.changeFailed")
    : assets.isError
      ? t("voiceDownloads.unavailable")
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
      downloadsEnded,
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
      downloadsEnded,
    ],
  );
}
