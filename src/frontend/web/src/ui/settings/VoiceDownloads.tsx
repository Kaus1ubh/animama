import { useState } from "react";
import { POCKET_VOICE_ENCODER_ASSET_ID } from "@/lib/speech/pocket/voice-cloning-encoder";
import { formatFileSize } from "@/lib/user-files/uploads";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { VoiceCloneLibrary } from "@/ui/animas/VoiceCloneLibrary";
import { Button } from "@/ui/components/button";
import {
  OfflineSpeechDownloads,
  OPERATOR_MANAGED_MODELS_NOTE,
  useOperatorManagedModels,
} from "./OfflineSpeechDownloads";
import cloningAttribution from "../../../../../../models/pocket-tts-voice-cloning/ATTRIBUTION.md?raw";

/** Optional downloads shared by setup and Voice settings; all install in place. */
export function VoiceDownloads({
  section = "all",
}: {
  section?: "all" | "speech-to-text" | "voice-clone";
}) {
  if (section === "speech-to-text") return <OfflineSpeechDownloads />;
  if (section === "voice-clone") return <VoiceCloningStatus />;
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label="Speech-to-Text">
        <h2 className="text-sm font-semibold">Speech-to-Text</h2>
        <OfflineSpeechDownloads />
      </section>
      <section className="space-y-3" aria-label="Voice Clone">
        <h2 className="text-sm font-semibold">Voice Clone</h2>
        <VoiceCloningStatus />
      </section>
    </div>
  );
}

/** Reuse the Anima voice-cloning form without tying creation to a selected Anima. */
export function VoiceCloneSettings() {
  const [cloning, setCloning] = useState(false);
  return (
    <div className="space-y-4">
      <VoiceCloningStatus busy={cloning} />
      <VoiceCloneLibrary
        heading={false}
        disabled={false}
        deleting={null}
        onDeleteClose={() => {}}
        onBusyChange={setCloning}
      />
    </div>
  );
}

/**
 * Managing the encoder never changes or deletes a saved clone or its original
 * sample. An operator-provided encoder shows only its state.
 */
function VoiceCloningStatus({ busy = false }: { busy?: boolean }) {
  const assets = useModelAssets({ enabled: true });
  const operatorManaged = useOperatorManagedModels();
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-40 flex-1">
          <p className="text-muted-foreground text-xs">
            Create named voices from your own samples.
          </p>
        </div>
        {operatorManaged ? null : (
          <>
            {asset && !installed && !downloading ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  action.busy ||
                  action.isPending ||
                  Boolean(action.blockedReason)
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
                disabled={busy || action.isPending || action.busy}
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
          </>
        )}
      </div>
      <p role="status" className="text-muted-foreground text-xs">
        {installed
          ? "Installed · Saved clones work without this model."
          : downloading
            ? progress === 1
              ? "Verifying voice cloning…"
              : `Downloading ${Math.round((progress ?? 0) * 100)}%`
            : asset
              ? operatorManaged
                ? "Not available"
                : `${formatFileSize(asset.size_bytes)} download${retry ? " · Retry available" : ""}`
              : assets.isError
                ? "Voice cloning downloads are unavailable. Reopen settings to retry."
                : "Checking voice cloning…"}
      </p>
      {operatorManaged ? (
        <p className="text-muted-foreground text-xs">
          {OPERATOR_MANAGED_MODELS_NOTE}
        </p>
      ) : null}
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
