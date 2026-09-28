import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import attribution from "../../../../../../models/pocket-tts-voice-cloning/ATTRIBUTION.md?raw";
import { formatFileSize } from "@/lib/user-files/uploads";
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
  const downloading = asset.status === "downloading";
  const progress =
    downloading && asset.total_bytes
      ? Math.min(1, (asset.bytes_downloaded ?? 0) / asset.total_bytes)
      : undefined;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Voice cloning needs a one-time {formatFileSize(asset.size_bytes)}{" "}
        download. Your audio sample stays on this installation. Eve, Azelma and
        other installed voices work without this download.
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
              ? "Download complete. Verifying voice cloning…"
              : `Downloading voice cloning${progress === undefined ? "…" : `: ${Math.round(progress * 100)}%`}`}
          </p>
          <progress
            className="w-full"
            max={1}
            value={progress}
            aria-label="Voice cloning download"
          />
          <p className="text-muted-foreground text-xs">
            Closing keeps the download running.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <details className="text-muted-foreground text-xs">
        <summary>Model attribution</summary>
        <pre className="mt-2 font-sans text-xs whitespace-pre-wrap">
          {attribution.trim()}
        </pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {downloading ? "Close" : "Not now"}
        </Button>
        {downloading ? (
          <Button
            type="button"
            variant="outline"
            disabled={cancelling}
            onClick={onCancelDownload}
          >
            {cancelling ? "Cancelling…" : "Cancel download"}
          </Button>
        ) : null}
        {!downloading || (error && !busy) ? (
          <Button type="button" disabled={busy} onClick={onDownload}>
            {busy
              ? "Preparing…"
              : error || asset.status === "failed"
                ? "Retry download"
                : "Download and clone"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
