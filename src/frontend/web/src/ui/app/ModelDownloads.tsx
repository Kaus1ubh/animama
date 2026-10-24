import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import { POCKET_VOICE_ENCODER_ASSET_ID } from "@/lib/speech/pocket/voice-cloning-encoder";
import {
  useModelAssets,
  useOperatorManagedModelAssets,
} from "@/query/hooks/useModelAssets";

/** Large optional models whose downloads are reported outside Settings. */
type ModelDownloadItem = "speechToText" | "speechToTextGpu" | "voiceClone";

// Pocket voices are small and install on demand, so they are not reported.
const REPORTED_ASSETS: Readonly<Record<string, ModelDownloadItem>> = {
  [PARAKEET_ASSET_ID]: "speechToText",
  [PARAKEET_WEBGPU_ASSET_ID]: "speechToTextGpu",
  [POCKET_VOICE_ENCODER_ASSET_ID]: "voiceClone",
};

/** A reported model the backend downloader is fetching from the internet. */
export type ModelDownload = {
  assetId: string;
  item: ModelDownloadItem;
  sizeBytes: number;
  /** Fraction downloaded, once the downloader knows the total. */
  progress: number | null;
};

/**
 * The installation's model assets, refreshed on mount and polled only while
 * one downloads. Operator-managed runtimes install nothing, so they skip it.
 */
function useReportedModelAssets() {
  const operatorManaged = useOperatorManagedModelAssets();
  return useModelAssets({ enabled: !operatorManaged }).data?.assets;
}

/** Reported models downloading now, in catalog order. */
export function useModelDownloads(): ModelDownload[] {
  const assets = useReportedModelAssets();
  return useMemo(
    () =>
      (assets ?? []).flatMap((asset) => {
        const item = REPORTED_ASSETS[asset.id];
        if (!item || asset.status !== "downloading") return [];
        const total = asset.total_bytes ?? 0;
        return [
          {
            assetId: asset.id,
            item,
            sizeBytes: asset.size_bytes,
            progress: total > 0 ? (asset.bytes_downloaded ?? 0) / total : null,
          },
        ];
      }),
    [assets],
  );
}

/** Display name of a reported model, with each key written out for extraction. */
export function modelDownloadLabel(
  t: TFunction<"app">,
  item: ModelDownloadItem,
): string {
  switch (item) {
    case "speechToText":
      return t("modelDownloads.items.speechToText");
    case "speechToTextGpu":
      return t("modelDownloads.items.speechToTextGpu");
    case "voiceClone":
      return t("modelDownloads.items.voiceClone");
  }
}

/**
 * One short toast when a reported download finishes or fails while the app is
 * open. The first list only sets the baseline, so a reload never re-announces.
 */
export function ModelDownloadToasts() {
  const { t } = useTranslation("app");
  const assets = useReportedModelAssets();
  const statuses = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!assets) return;
    const before = statuses.current;
    statuses.current = new Map(assets.map((asset) => [asset.id, asset.status]));
    if (!before) return;
    for (const asset of assets) {
      const item = REPORTED_ASSETS[asset.id];
      if (!item || before.get(asset.id) !== "downloading") continue;
      const label = modelDownloadLabel(t, item);
      if (asset.status === "installed")
        toast.success(t("modelDownloads.ready", { item: label }));
      else if (asset.status === "failed")
        toast.error(t("modelDownloads.failed", { item: label }));
    }
  }, [assets, t]);
  return null;
}
