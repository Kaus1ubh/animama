import { useCallback, useMemo } from "react";

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
  const { mutate } = useModelAssetAction();
  const availability = useMemo(
    () => pocketVoiceAvailability(assets.data?.assets),
    [assets.data],
  );
  const install = useCallback(
    (assetId: string) => mutate({ action: "install", assetId }),
    [mutate],
  );
  return { availability, install };
}
