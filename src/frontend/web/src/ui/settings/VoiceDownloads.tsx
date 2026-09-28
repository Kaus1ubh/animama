import { useState } from "react";
import type {
  FeaturePackId,
  FeaturePackStatus,
} from "../../../../shared/desktop-runtime";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import { POCKET_VOICE_ENCODER_ASSET_ID } from "@/lib/speech/pocket/voice-cloning-encoder";
import { formatFileSize } from "@/lib/user-files/uploads";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { PocketVoicePicker } from "@/ui/animas/PocketVoicePicker";
import { Button } from "@/ui/components/button";
import { ParakeetWebgpuDetails } from "./ExperimentalSettings";
import cloningAttribution from "../../../../../../models/pocket-tts-voice-cloning/ATTRIBUTION.md?raw";

type VoiceDownloadsProps = {
  section?: "all" | "speech-to-text" | "text-to-speech";
  /** Unsaved credentials block only operations that can replace the renderer. */
  blockedReason?: string | null;
  busy?: boolean;
};

/** The same optional actions serve setup and settings, independently of provider selection. */
export function VoiceDownloads({
  section = "all",
  ...guard
}: VoiceDownloadsProps) {
  return (
    <div className="space-y-4">
      {section !== "text-to-speech" ? (
        <SpeechRecognitionDownloads {...guard} />
      ) : null}
      {section !== "speech-to-text" ? <SpeechSynthesisDownloads /> : null}
    </div>
  );
}

function SpeechRecognitionDownloads({
  blockedReason,
  busy,
}: Omit<VoiceDownloadsProps, "section">) {
  const packs = useDesktopFeaturePacks();
  const cpu = packs.packs.find((pack) => pack.id === "parakeet-stt");
  return (
    <div className="space-y-3">
      {packs.available && cpu ? (
        <OfflineSpeechDownload
          pack={cpu}
          busy={Boolean(busy || packs.busy)}
          blockedReason={blockedReason || packs.blockedReason}
          error={packs.error}
          run={(operation, id) => void packs.run(operation, id)}
        />
      ) : null}
      <ParakeetWebgpuDetails
        selected={false}
        independent
        busy={busy}
        blockedReason={blockedReason}
      />
    </div>
  );
}

/** CPU installation is one explicit action; completion never starts the separate GPU download. */
export function OfflineSpeechDownload({
  pack,
  busy,
  blockedReason,
  error,
  run,
}: {
  pack: FeaturePackStatus;
  busy: boolean;
  blockedReason: string | null | undefined;
  error?: string | null;
  run: (operation: "install" | "remove" | "cancel", id: FeaturePackId) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const installed =
    pack.state === "installed" ||
    Boolean(pack.activeVersion && pack.activeVersion === pack.version);
  const downloading = ["downloading", "verifying", "installing"].includes(
    pack.state,
  );
  if (
    !pack.available &&
    !pack.hasInstalledFiles &&
    !downloading &&
    pack.state !== "failed"
  )
    return null;
  const blocked = busy || Boolean(blockedReason);
  return (
    <div
      className="space-y-2 rounded-lg border p-3"
      aria-label="Offline speech recognition download"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">Offline speech recognition</p>
          <p className="text-muted-foreground text-xs">
            Dictation and Voice Mode on your CPU.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!installed && !downloading && pack.available ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() => run("install", pack.id)}
            >
              {pack.state === "failed"
                ? "Retry speech download"
                : pack.state === "update_available"
                  ? "Install compatible speech recognition"
                  : "Download speech recognition"}
            </Button>
          ) : null}
          {downloading ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => run("cancel", pack.id)}
            >
              Cancel download
            </Button>
          ) : null}
          {pack.hasInstalledFiles && !downloading ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => {
                if (!confirmRemove) setConfirmRemove(true);
                else {
                  setConfirmRemove(false);
                  run("remove", pack.id);
                }
              }}
            >
              {confirmRemove ? "Confirm removal" : "Remove speech recognition"}
            </Button>
          ) : null}
        </div>
      </div>
      <p role="status" className="text-muted-foreground text-xs">
        {downloading
          ? pack.state === "downloading"
            ? `Downloading ${Math.round((pack.progress ?? 0) * 100)}%`
            : pack.state === "verifying"
              ? "Verifying download…"
              : "Activating offline speech…"
          : installed
            ? "Installed"
            : pack.downloadBytes === undefined
              ? "Download size unavailable"
              : `${formatFileSize(pack.downloadBytes)} download${pack.minimumFreeBytes === undefined ? "" : ` · ${formatFileSize(pack.minimumFreeBytes)} free space required`}`}
      </p>
      {downloading ? (
        <progress
          className="w-full"
          max={1}
          value={pack.progress ?? undefined}
          aria-label="Offline speech recognition progress"
        />
      ) : null}
      <p className="text-muted-foreground text-xs">
        Installing or removing this model briefly reloads the app.
      </p>
      {pack.state === "failed" && pack.error ? (
        <p role="status" className="text-muted-foreground text-xs">
          The last change did not finish ({pack.error}). Retry when ready.
        </p>
      ) : null}
      {blockedReason || error ? (
        <p role="status" className="text-muted-foreground text-xs">
          {blockedReason || error}
        </p>
      ) : null}
    </div>
  );
}

function SpeechSynthesisDownloads() {
  const voices = usePocketVoiceDownloads({ enabled: true });
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-40 flex-1">
            <p className="text-sm font-medium">PocketTTS voices</p>
            <p className="text-muted-foreground text-xs">
              Eve and Azelma are included. Browse and download more voices.
            </p>
          </div>
          <PocketVoicePicker
            downloadOnly
            disabled={false}
            availability={voices.availability}
            onDownload={voices.install}
            onRemove={voices.remove}
            downloadBusy={voices.busy}
            downloadBlockedReason={voices.blockedReason}
            downloadError={voices.error}
            retryAssetIds={voices.retryAssetIds}
          />
        </div>
      </div>
      <VoiceCloningStatus />
    </div>
  );
}

/** Managing the encoder never changes or deletes a saved clone or its original sample. */
function VoiceCloningStatus() {
  const assets = useModelAssets({ enabled: true });
  const action = useModelAssetAction();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const asset = assets.data?.assets.find(
    (item) => item.id === POCKET_VOICE_ENCODER_ASSET_ID,
  );
  const installed = asset?.status === "installed";
  const downloading = asset?.status === "downloading";
  const progress =
    downloading && asset.total_bytes
      ? Math.min(1, (asset.bytes_downloaded ?? 0) / asset.total_bytes)
      : undefined;
  const retry =
    asset?.status === "failed" ||
    assets.retryAssetIds?.has(POCKET_VOICE_ENCODER_ASSET_ID);
  const change = (operation: "install" | "remove") =>
    action.mutate({
      action: operation,
      assetId: POCKET_VOICE_ENCODER_ASSET_ID,
    });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">Voice cloning</p>
          <p className="text-muted-foreground text-xs">
            Create named voices from your own samples.
          </p>
        </div>
        {asset && !installed && !downloading ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              action.busy || action.isPending || Boolean(action.blockedReason)
            }
            onClick={() => change("install")}
          >
            {retry ? "Retry cloning download" : "Download voice cloning"}
          </Button>
        ) : null}
        {downloading ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.isPending}
            onClick={() => change("remove")}
          >
            Cancel download
          </Button>
        ) : null}
        {installed ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.isPending || action.busy}
            onClick={() => {
              if (!confirmRemove) setConfirmRemove(true);
              else {
                setConfirmRemove(false);
                change("remove");
              }
            }}
          >
            {confirmRemove ? "Confirm removal" : "Remove voice cloning"}
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-muted-foreground text-xs">
        {installed
          ? "Installed · Saved clones work without this model."
          : downloading
            ? progress === 1
              ? "Verifying voice cloning…"
              : `Downloading ${Math.round((progress ?? 0) * 100)}%`
            : asset
              ? `${formatFileSize(asset.size_bytes)} download${retry ? " · Retry available" : ""}`
              : assets.isError
                ? "Voice cloning downloads are unavailable. Reopen settings to retry."
                : "Checking voice cloning…"}
      </p>
      {downloading ? (
        <progress
          className="w-full"
          max={1}
          value={progress}
          aria-label="Voice cloning download progress"
        />
      ) : null}
      {action.blockedReason || action.isError ? (
        <p role="alert" className="text-muted-foreground text-xs">
          {action.blockedReason ||
            "The cloning model change did not finish. Retry in a moment."}
        </p>
      ) : null}
      {asset?.status === "failed" ? (
        <p role="status" className="text-muted-foreground text-xs">
          The download did not finish. Check available disk space and your
          connection, then retry.
        </p>
      ) : null}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">Model attribution</summary>
        <pre className="mt-2 font-sans whitespace-pre-wrap">
          {cloningAttribution.trim()}
        </pre>
      </details>
    </div>
  );
}
