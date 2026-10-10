import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import attribution from "../../../../../../models/pocket-tts-voice-cloning/ATTRIBUTION.md?raw";
import { Button } from "@/ui/components/button";

/** First-use download controls; closing the containing view only detaches its waiter. */
export function VoiceCloningDownload({
  asset,
  sampleName,
  error,
  busy,
  cancelling,
  onDownload,
  onCancelDownload,
  onClose,
}: {
  asset: PyModelAssetState;
  sampleName: string;
  error: string | null;
  busy: boolean;
  cancelling: boolean;
  onDownload: () => void;
  onCancelDownload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("animas");
  const formatters = useFormatters();
  const downloading = asset.status === "downloading";
  const progress =
    downloading && asset.total_bytes
      ? Math.min(1, (asset.bytes_downloaded ?? 0) / asset.total_bytes)
      : undefined;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {t("voices.cloning.download.intro", {
          size: formatters.fileSize(asset.size_bytes),
        })}
      </p>
      <p
        className="bg-muted/30 truncate rounded-lg px-3 py-2 text-sm"
        title={sampleName}
      >
        {sampleName}
      </p>
      {downloading ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs" role="status">
            {progress === 1
              ? t("voices.cloning.download.verifying")
              : progress === undefined
                ? t("voices.cloning.download.progressUnknown")
                : t("voices.cloning.download.progress", {
                    percent: formatters.number(progress, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    }),
                  })}
          </p>
          <progress
            className="w-full"
            max={1}
            value={progress}
            aria-label={t("voices.cloning.download.progressLabel")}
          />
          <p className="text-muted-foreground text-xs">
            {t("voices.cloning.download.closingKeeps")}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <details className="text-muted-foreground text-xs">
        <summary>{t("voices.cloning.download.attribution")}</summary>
        <pre className="mt-2 font-sans text-xs whitespace-pre-wrap">
          {attribution.trim()}
        </pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {downloading
            ? t("voices.cloning.download.close")
            : t("voices.cloning.download.notNow")}
        </Button>
        {downloading ? (
          <Button
            type="button"
            variant="outline"
            disabled={cancelling}
            onClick={onCancelDownload}
          >
            {cancelling
              ? t("voices.cloning.download.cancelling")
              : t("voices.cloning.download.cancel")}
          </Button>
        ) : null}
        {!downloading || (error && !busy) ? (
          <Button type="button" disabled={busy} onClick={onDownload}>
            {busy
              ? t("voices.cloning.download.preparing")
              : error || asset.status === "failed"
                ? t("voices.cloning.download.retry")
                : t("voices.cloning.download.start")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
