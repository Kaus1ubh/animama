import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import parakeetWebgpuAttribution from "../../../../../../models/parakeet-tdt-0.6b-v2-webgpu/ATTRIBUTION.md?raw";
import type {
  FeaturePackId,
  FeaturePackStatus,
} from "../../../../shared/desktop-runtime";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import {
  CLIENT_PARAKEET_WEBGPU_ENCODER,
  PARAKEET_WEBGPU_ENCODER_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import {
  getLastClientParakeetBackendState,
  getParakeetWebgpuStatus,
} from "@/lib/speech/client-parakeet/client";
import type { ParakeetWebgpuStatus } from "@/lib/speech/client-parakeet/webgpu";
import { formatFileSize } from "@/lib/user-files/uploads";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { Button } from "@/ui/components/button";

const WEBGPU_STATUS_TEXT: Record<ParakeetWebgpuStatus, string> = {
  available:
    "Available on this device. Applies the next time dictation or Voice Mode starts.",
  unsupported: "WebGPU is not available in this browser or on this device.",
  model_missing:
    "The GPU speech model is not installed. Development stacks: run python3 scripts/models/parakeet_webgpu.py acquire on the host, then rerun reset.sh.",
  unavailable_in_build: "Not available in this build.",
};
const GPU_PACK: FeaturePackId = "parakeet-stt-webgpu";
const BASE_PACK: FeaturePackId = "parakeet-stt";
const BUSY_STATES = new Set(["downloading", "verifying", "installing"]);

/**
 * Desktop download control for the GPU encoder pack. It is offered only when
 * the probe found a WebGPU adapter (any status except `unsupported`) and the
 * app's catalog includes the pack; devices without WebGPU never see it.
 */
export function ParakeetWebgpuDownload({
  status,
  gpuPack,
  basePack,
  pending,
  error,
  prompted,
  run,
  busy: transitionBusy = false,
  blockedReason,
}: {
  status: ParakeetWebgpuStatus | null;
  gpuPack: FeaturePackStatus | undefined;
  basePack: FeaturePackStatus | undefined;
  pending: FeaturePackId | null;
  error?: string | null;
  prompted: boolean;
  busy?: boolean;
  blockedReason?: string | null;
  run(operation: "install" | "remove" | "cancel", id: FeaturePackId): void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (
    !gpuPack ||
    (!gpuPack.available &&
      !gpuPack.hasInstalledFiles &&
      !BUSY_STATES.has(gpuPack.state) &&
      gpuPack.state !== "failed")
  )
    return null;
  // A refused or interrupted removal reports `failed` while this version stays active.
  const installed =
    gpuPack.state === "installed" ||
    (!!gpuPack.activeVersion && gpuPack.activeVersion === gpuPack.version);
  // Removal and recovery stay reachable even if this device later loses WebGPU.
  if (
    !installed &&
    !gpuPack.hasInstalledFiles &&
    !BUSY_STATES.has(gpuPack.state) &&
    gpuPack.state !== "failed" &&
    status !== "model_missing"
  )
    return null;
  const busy = BUSY_STATES.has(gpuPack.state);
  const baseReady =
    basePack?.state === "installed" || !!basePack?.activeVersion;
  const blocked = pending !== null || transitionBusy || Boolean(blockedReason);
  const supported = status === "model_missing" || status === "available";
  const size =
    gpuPack.downloadBytes !== undefined &&
    gpuPack.minimumFreeBytes !== undefined
      ? `${formatFileSize(gpuPack.downloadBytes)} download · ${formatFileSize(gpuPack.minimumFreeBytes)} free space required`
      : null;
  return (
    <div className="mt-2 space-y-2" data-testid="parakeet-webgpu-download">
      {prompted && !installed ? (
        <p className="text-sm" role="status">
          Download the GPU speech encoder to use this setting.
        </p>
      ) : null}
      {size && !installed ? (
        <p className="text-muted-foreground text-xs">{size}</p>
      ) : null}
      {!installed && !baseReady && !busy ? (
        <p className="text-muted-foreground text-xs">
          Download offline speech recognition first using the action above.
        </p>
      ) : null}
      {busy ? (
        <progress
          className="w-full"
          max={1}
          value={gpuPack.progress ?? 0}
          aria-label="GPU speech encoder progress"
        />
      ) : null}
      {!busy ? (
        <p className="text-muted-foreground text-xs">
          Save unfinished edits first. Installing or removing the encoder
          briefly reloads the app.
        </p>
      ) : null}
      {gpuPack.state === "failed" && gpuPack.error ? (
        <p className="text-muted-foreground text-xs" role="status">
          The last change did not finish ({gpuPack.error}).
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!installed && !busy && gpuPack.available ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!baseReady || blocked || !supported}
            onClick={() => run("install", GPU_PACK)}
          >
            <Download aria-hidden className="size-4" />
            {gpuPack.state === "failed"
              ? "Retry download"
              : gpuPack.state === "update_available"
                ? "Install compatible version"
                : "Download GPU enhancement"}
          </Button>
        ) : null}
        {busy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => run("cancel", GPU_PACK)}
          >
            Cancel
          </Button>
        ) : null}
        {gpuPack.hasInstalledFiles && !busy ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() => {
              if (!confirmRemove) setConfirmRemove(true);
              else {
                setConfirmRemove(false);
                run("remove", GPU_PACK);
              }
            }}
          >
            {confirmRemove ? "Confirm removal" : "Remove GPU enhancement"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {blockedReason ? (
        <p className="text-muted-foreground text-xs" role="status">
          {blockedReason}
        </p>
      ) : null}
    </div>
  );
}

// Stable failure codes from the model-asset API; they never carry paths.
const ASSET_FAILURE_TEXT: Record<
  NonNullable<PyModelAssetState["reason"]>,
  string
> = {
  asset_download_failed:
    "The download did not finish. Check the server's internet connection, then retry.",
  asset_host_not_allowed: "This build does not allow the download source.",
  asset_size_invalid:
    "The downloaded file did not have the expected size and was discarded.",
  asset_hash_invalid:
    "The downloaded file did not match its checksum and was discarded.",
  asset_store_failed:
    "The server could not store the file. Check its data directory, then retry.",
  asset_insufficient_space: "Not enough free space for downloads.",
};

/**
 * Self-host download control for the GPU encoder, installed by the backend
 * into the installation's data root and verified before it is served. Like the
 * desktop control, it is offered only after the probe found a WebGPU adapter;
 * a running, failed or installed download stays reachable without one.
 */
export function ParakeetWebgpuAssetDownload({
  status,
  asset,
  freeBytes,
  pending,
  error,
  prompted,
  onInstall,
  onCancel,
  onRemove,
  retry = false,
  blockedReason,
}: {
  status: ParakeetWebgpuStatus | null;
  asset: PyModelAssetState | undefined;
  freeBytes: number | null | undefined;
  pending: boolean;
  error?: string | null;
  prompted: boolean;
  onInstall(): void;
  onCancel(): void;
  onRemove(): void;
  retry?: boolean;
  blockedReason?: string | null;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (!asset) return null;
  const installed = asset.status === "installed";
  const busy = asset.status === "downloading";
  const failed = asset.status === "failed" || retry;
  if (!installed && !busy && !failed && status !== "model_missing") return null;
  const measured = typeof freeBytes === "number";
  const enoughSpace = !measured || freeBytes >= asset.required_free_bytes;
  // Without a known total, an indeterminate bar (no value) shows activity.
  const progress =
    busy && asset.total_bytes
      ? Math.round(((asset.bytes_downloaded ?? 0) / asset.total_bytes) * 100) /
        100
      : undefined;
  return (
    <div className="mt-2 space-y-2" data-testid="parakeet-webgpu-download">
      {prompted && !installed ? (
        <p className="text-sm" role="status">
          Download the GPU speech encoder to use this setting.
        </p>
      ) : null}
      {!installed && !busy ? (
        <p className="text-muted-foreground text-xs">
          {formatFileSize(asset.size_bytes)} download
          {measured ? ` · ${formatFileSize(freeBytes)} free for downloads` : ""}
        </p>
      ) : null}
      {!installed && !busy && !enoughSpace ? (
        <p className="text-muted-foreground text-xs" role="status">
          Not enough free space: downloads need{" "}
          {formatFileSize(asset.required_free_bytes)} free.
        </p>
      ) : null}
      {busy ? (
        <progress
          className="w-full"
          max={1}
          value={progress}
          aria-label="GPU speech encoder progress"
        />
      ) : null}
      {failed && asset.reason ? (
        <p className="text-muted-foreground text-xs" role="status">
          {ASSET_FAILURE_TEXT[asset.reason] ?? "The download did not finish."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!installed && !busy ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              pending ||
              !enoughSpace ||
              Boolean(blockedReason) ||
              (status !== "model_missing" && status !== "available")
            }
            onClick={onInstall}
          >
            <Download aria-hidden className="size-4" />
            {failed ? "Retry download" : "Download GPU enhancement"}
          </Button>
        ) : null}
        {busy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        {installed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (!confirmRemove) setConfirmRemove(true);
              else {
                setConfirmRemove(false);
                onRemove();
              }
            }}
          >
            {confirmRemove ? "Confirm removal" : "Remove GPU enhancement"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {blockedReason ? (
        <p className="text-muted-foreground text-xs" role="status">
          {blockedReason}
        </p>
      ) : null}
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          Model attribution (CC BY 4.0)
        </summary>
        {/* Plain text keeps the reviewed notice compact inside a settings row. */}
        <pre className="text-muted-foreground mt-2 font-sans text-xs whitespace-pre-wrap">
          {parakeetWebgpuAttribution.trim()}
        </pre>
      </details>
    </div>
  );
}

/** Availability and encoder management below the Parakeet WebGPU provider choice. */
export function ParakeetWebgpuDetails({
  selected,
  independent = false,
  busy = false,
  blockedReason,
}: {
  selected: boolean;
  independent?: boolean;
  busy?: boolean;
  blockedReason?: string | null;
}) {
  const featurePacks = useDesktopFeaturePacks();
  const gpuPack = featurePacks.available
    ? featurePacks.packs.find((pack) => pack.id === GPU_PACK)
    : undefined;
  const basePack = featurePacks.packs.find((pack) => pack.id === BASE_PACK);
  // Built self-host downloads the encoder through the backend's model assets.
  const selfHostAsset =
    CLIENT_PARAKEET_WEBGPU_ENCODER?.source === "model-asset";
  const modelAssets = useModelAssets({ enabled: selfHostAsset });
  const encoderAsset = modelAssets.data?.assets.find(
    (asset) => asset.id === PARAKEET_WEBGPU_ENCODER_ASSET_ID,
  );
  const assetAction = useModelAssetAction();
  const retryAsset =
    modelAssets.retryAssetIds?.has(PARAKEET_WEBGPU_ENCODER_ASSET_ID) ?? false;
  const downloadable = Boolean(gpuPack?.available) || Boolean(encoderAsset);
  const desktop = useRuntimePlatform().kind === "desktop";
  const [status, setStatus] = useState<ParakeetWebgpuStatus | null>(null);

  // Recheck when the encoder pack or asset settles (pack changes also reload
  // the app; asset changes apply without a reload).
  const gpuPackState = gpuPack?.state;
  const encoderAssetStatus = encoderAsset?.status;
  useEffect(() => {
    let cancelled = false;
    void getParakeetWebgpuStatus({ refresh: true }).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [gpuPackState, encoderAssetStatus]);

  // An installed or interrupted encoder must stay manageable even if the base
  // speech pack is unavailable and neither Parakeet choice can be selected.
  const hasManagedEncoder =
    gpuPack?.hasInstalledFiles ||
    (gpuPack &&
      (BUSY_STATES.has(gpuPack.state) || gpuPack.state === "failed")) ||
    (encoderAsset && (encoderAsset.status !== "not_installed" || retryAsset));
  if (!selected && !hasManagedEncoder && !independent) return null;
  if (
    independent &&
    !hasManagedEncoder &&
    (!downloadable || (status !== "model_missing" && status !== "available"))
  )
    return null;

  const lastBackend = getLastClientParakeetBackendState();
  const statusText = lastBackend?.fellBackFromWebgpu
    ? "WebGPU failed to load in the last session, so offline speech used the CPU."
    : lastBackend?.backend === "webgpu"
      ? "Active: offline speech is running on WebGPU with live previews."
      : encoderAsset?.status === "downloading"
        ? "Downloading the GPU speech encoder. Offline speech keeps using the CPU until it finishes."
        : status === "model_missing" && downloadable
          ? "The GPU speech encoder is not installed. Download it below; your offline speech keeps using the CPU until then."
          : status === "model_missing" && desktop && featurePacks.available
            ? "The GPU speech encoder is not installed, and this app version does not include it."
            : status === "model_missing" && selfHostAsset
              ? modelAssets.isPending
                ? "Checking the GPU speech encoder…"
                : "The GPU speech encoder is not installed, and its download is unavailable right now. Reopen Settings to try again."
              : status
                ? WEBGPU_STATUS_TEXT[status]
                : "Checking WebGPU support…";

  return (
    <div
      className={independent ? "space-y-2 rounded-lg border p-3" : "space-y-2"}
    >
      {independent ? (
        <p className="text-sm font-medium">GPU speech acceleration</p>
      ) : null}
      <p
        className="text-muted-foreground text-xs"
        data-testid="parakeet-webgpu-status"
      >
        {independent && !hasManagedEncoder
          ? "Adds GPU acceleration and live previews to offline speech recognition."
          : selected || independent
            ? statusText
            : "GPU speech encoder"}
      </p>
      {selfHostAsset ? (
        <ParakeetWebgpuAssetDownload
          status={status}
          asset={encoderAsset}
          freeBytes={modelAssets.data?.free_bytes}
          pending={assetAction.isPending}
          blockedReason={assetAction.blockedReason}
          retry={retryAsset}
          error={
            assetAction.isError
              ? "The encoder change could not finish. Retry in a moment."
              : null
          }
          prompted={selected && status === "model_missing"}
          onInstall={() =>
            assetAction.mutate({
              action: "install",
              assetId: PARAKEET_WEBGPU_ENCODER_ASSET_ID,
            })
          }
          onCancel={() =>
            assetAction.mutate({
              action: "remove",
              assetId: PARAKEET_WEBGPU_ENCODER_ASSET_ID,
            })
          }
          onRemove={() =>
            assetAction.mutate({
              action: "remove",
              assetId: PARAKEET_WEBGPU_ENCODER_ASSET_ID,
            })
          }
        />
      ) : (
        <ParakeetWebgpuDownload
          status={status}
          gpuPack={gpuPack}
          basePack={basePack}
          pending={featurePacks.pending}
          busy={busy || featurePacks.busy}
          blockedReason={blockedReason || featurePacks.blockedReason}
          error={featurePacks.error}
          prompted={selected && status === "model_missing"}
          run={(operation, id) => void featurePacks.run(operation, id)}
        />
      )}
    </div>
  );
}
