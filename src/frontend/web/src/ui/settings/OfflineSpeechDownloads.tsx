import { useEffect, useState, type ReactNode } from "react";

import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import parakeetWebgpuAttribution from "../../../../../../models/parakeet-tdt-0.6b-v2-webgpu/ATTRIBUTION.md?raw";
import {
  PARAKEET_ASSET_ID,
  PARAKEET_DOWNLOADS_OFFERED,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import {
  disposeIdleClientParakeetWorker,
  getLastClientParakeetBackendState,
  getParakeetWebgpuStatus,
} from "@/lib/speech/client-parakeet/client";
import type { ParakeetWebgpuStatus } from "@/lib/speech/client-parakeet/webgpu";
import { formatFileSize } from "@/lib/user-files/uploads";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { PACK_WORK_BLOCKS_ASSET } from "@/query/model-download-coordination";
import { Button } from "@/ui/components/button";

// Stable failure codes from the model-asset API; they never carry paths.
const ASSET_FAILURE_TEXT: Record<
  NonNullable<PyModelAssetState["reason"]>,
  string
> = {
  asset_download_failed:
    "The download did not finish. Check the internet connection, then retry.",
  asset_host_not_allowed: "This build does not allow the download source.",
  asset_size_invalid:
    "A downloaded file did not have the expected size and was discarded.",
  asset_hash_invalid:
    "A downloaded file did not match its checksum and was discarded.",
  asset_store_failed:
    "The model could not be stored. Check the data directory, then retry.",
  asset_insufficient_space: "Not enough free space for downloads.",
};

// Refusals of a model change (HTTP 409 `detail.code`).
const REFUSAL_TEXT: Record<string, string> = {
  model_asset_in_use:
    "Speech recognition is in use. Close dictation and Voice Mode to remove it.",
  model_asset_required_by: "Remove GPU acceleration first.",
  model_asset_requires: "Download the CPU model first.",
  model_asset_busy: "This model is still changing. Retry in a moment.",
};

/** Why a failed download stopped, from its stable failure code. */
export function assetFailureText(asset: PyModelAssetState): string {
  return (
    (asset.reason && ASSET_FAILURE_TEXT[asset.reason]) ??
    "The download did not finish. Retry when ready."
  );
}

/** A readable message for a failed model change, never a raw payload. */
export function modelChangeErrorText(error: unknown): string {
  if (error instanceof Error && error.message === PACK_WORK_BLOCKS_ASSET)
    return PACK_WORK_BLOCKS_ASSET;
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: { code?: unknown } }).detail
      : undefined;
  const code = typeof detail?.code === "string" ? detail.code : "";
  return (
    REFUSAL_TEXT[code] ?? "The change could not finish. Retry in a moment."
  );
}

/**
 * Why the GPU add-on cannot be installed now, or `null` when it can. A device
 * without WebGPU is reported before the missing CPU model, so nobody installs
 * a prerequisite for an add-on their device cannot use.
 */
export function gpuInstallBlockedReason({
  gpu,
  cpuInstalled,
  support,
}: {
  gpu: PyModelAssetState | undefined;
  cpuInstalled: boolean;
  support: ParakeetWebgpuStatus | null;
}): string | null {
  if (!gpu) return "GPU acceleration is unavailable in this build.";
  if (support === "unsupported")
    return "WebGPU is not available in this browser or on this device.";
  if (!cpuInstalled) return "Download the CPU model first.";
  if (support === null) return "Checking WebGPU support…";
  return null;
}

type Change = "install" | "cancel" | "remove";

/** Shown instead of model actions where the runtime's operator provides models. */
export const OPERATOR_MANAGED_MODELS_NOTE =
  "Speech models are managed by the hosted operator.";

/**
 * Whether the runtime's operator provisions speech models. Installing or
 * removing them is server model installation, which belongs to local
 * filesystem administration; without that permission (hosted) the model-asset
 * service refuses both, so the UI shows each model's state without actions.
 */
export function useOperatorManagedModels(): boolean {
  return (
    useRuntimeCapabilities().data?.local_filesystem_administration !== true
  );
}

export type OfflineSpeechDownloadsViewProps = {
  cpu: PyModelAssetState | undefined;
  gpu: PyModelAssetState | undefined;
  freeBytes?: number | null;
  /** WebGPU probe result; `null` while probing. */
  gpuSupport: ParakeetWebgpuStatus | null;
  retryAssetIds?: ReadonlySet<string>;
  /** A change request is in flight, or a feature pack change blocks downloads. */
  pending: boolean;
  blockedReason?: string | null;
  /** The last failed change, attributed to its asset. */
  error?: { assetId: string; message: string } | null;
  /** WebGPU failed to load in the last session, so the CPU was used. */
  gpuFellBack?: boolean;
  /** Unavailable list (`true`) differs from a list still loading. */
  listUnavailable?: boolean;
  /** The server operator turned offline speech off, even with sets installed. */
  turnedOff?: boolean;
  /** The operator provides the sets; show their state without actions. */
  operatorManaged?: boolean;
  heading?: boolean;
  onChange(change: Change, assetId: string): void;
};

/**
 * Offline speech recognition: the base (CPU) Parakeet set with its GPU
 * acceleration add-on, installed in place by the backend model-asset service.
 * The add-on is always shown; when it cannot be installed, its action is
 * disabled with the reason. Operator-managed sets show only their state.
 */
export function OfflineSpeechDownloadsView({
  cpu,
  gpu,
  freeBytes,
  gpuSupport,
  retryAssetIds,
  pending,
  blockedReason,
  error,
  gpuFellBack = false,
  listUnavailable = false,
  turnedOff = false,
  operatorManaged = false,
  heading = true,
  onChange,
}: OfflineSpeechDownloadsViewProps) {
  // Without a list, the add-on's availability is still unknown.
  const listReady = cpu !== undefined || gpu !== undefined;
  const cpuInstalled = cpu?.status === "installed";
  // The backend refuses CPU removal while the add-on is installed or downloading.
  const gpuActive =
    gpu?.status === "installed" || gpu?.status === "downloading";
  const errorFor = (assetId: string) =>
    error?.assetId === assetId ? error.message : null;
  return (
    <section
      className="space-y-3"
      aria-label="Offline speech recognition (Parakeet)"
    >
      {heading ? (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            Offline speech recognition (Parakeet)
          </h3>
          <p className="text-muted-foreground text-xs">
            Dictation and Voice Mode transcribe on this device, so audio never
            leaves it.
          </p>
        </div>
      ) : null}
      {turnedOff && cpuInstalled ? (
        <p role="status" className="text-muted-foreground text-xs">
          Offline speech recognition is turned off on this server.
        </p>
      ) : null}
      {operatorManaged ? (
        <p className="text-muted-foreground text-xs">
          {OPERATOR_MANAGED_MODELS_NOTE}
        </p>
      ) : null}
      {cpu ? (
        <ModelSetRow
          label="CPU model"
          asset={cpu}
          managed={operatorManaged}
          names={{ install: "Download CPU model", remove: "Remove CPU model" }}
          freeBytes={freeBytes}
          retry={retryAssetIds?.has(cpu.id) ?? false}
          pending={pending}
          installBlockedReason={blockedReason ?? null}
          removeBlockedReason={
            gpuActive ? "Remove GPU acceleration first." : null
          }
          error={errorFor(cpu.id)}
          onChange={(change) => onChange(change, cpu.id)}
        />
      ) : (
        <p role="status" className="text-muted-foreground text-xs">
          {listUnavailable
            ? "Speech downloads are unavailable. Reopen Settings to retry."
            : "Checking offline speech recognition…"}
        </p>
      )}
      <div className="border-border/60 space-y-2 border-l-2 pl-3">
        <ModelSetRow
          label="GPU acceleration"
          description="Faster recognition with live previews. Requires the CPU model and a WebGPU-capable device."
          asset={gpu}
          managed={operatorManaged}
          names={{
            install: "Download GPU acceleration",
            remove: "Remove GPU acceleration",
          }}
          freeBytes={freeBytes}
          retry={gpu ? (retryAssetIds?.has(gpu.id) ?? false) : false}
          pending={pending}
          installBlockedReason={
            listReady
              ? (gpuInstallBlockedReason({
                  gpu,
                  cpuInstalled,
                  support: gpuSupport,
                }) ??
                blockedReason ??
                null)
              : listUnavailable
                ? "GPU acceleration is unavailable right now."
                : "Checking offline speech recognition…"
          }
          removeBlockedReason={null}
          error={gpu ? errorFor(gpu.id) : null}
          installedNote={
            gpuFellBack
              ? "WebGPU failed to load last time, so speech recognition used the CPU."
              : undefined
          }
          onChange={(change) => gpu && onChange(change, gpu.id)}
        >
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer">
              Model attribution (CC BY 4.0)
            </summary>
            {/* Plain text keeps the reviewed notice compact inside a settings row. */}
            <pre className="text-muted-foreground mt-2 font-sans text-xs whitespace-pre-wrap">
              {parakeetWebgpuAttribution.trim()}
            </pre>
          </details>
        </ModelSetRow>
      </div>
    </section>
  );
}

/**
 * One installable set: size, progress, cancel, retry and confirmed removal.
 * A `managed` set is provided by the operator and shows only its state.
 */
function ModelSetRow({
  label,
  description,
  asset,
  managed = false,
  names,
  freeBytes,
  retry,
  pending,
  installBlockedReason,
  removeBlockedReason,
  error,
  installedNote,
  onChange,
  children,
}: {
  label: string;
  description?: string;
  asset: PyModelAssetState | undefined;
  managed?: boolean;
  names: { install: string; remove: string };
  freeBytes?: number | null;
  retry: boolean;
  pending: boolean;
  installBlockedReason: string | null;
  removeBlockedReason: string | null;
  error: string | null;
  installedNote?: string;
  onChange(change: Change): void;
  children?: ReactNode;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const installed = asset?.status === "installed";
  const downloading = asset?.status === "downloading";
  const failed = asset?.status === "failed" || retry;
  const lowSpace =
    asset !== undefined &&
    !installed &&
    !downloading &&
    typeof freeBytes === "number" &&
    freeBytes < asset.required_free_bytes;
  // Without a known total, an indeterminate bar (no value) shows activity.
  const progress =
    downloading && asset.total_bytes
      ? Math.min(1, (asset.bytes_downloaded ?? 0) / asset.total_bytes)
      : undefined;
  const installBlocked =
    installBlockedReason ??
    (lowSpace
      ? `Not enough free space: downloads need ${formatFileSize(asset.required_free_bytes)} free.`
      : null);
  const status = !asset
    ? null
    : installed
      ? `Installed${installedNote ? ` · ${installedNote}` : ""}`
      : downloading
        ? progress === 1
          ? "Verifying download…"
          : `Downloading ${Math.round((progress ?? 0) * 100)}%`
        : managed
          ? "Not available"
          : `${formatFileSize(asset.size_bytes)} download`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        {managed ? null : (
          <div className="flex flex-wrap gap-2">
            {!installed && !downloading ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || Boolean(installBlocked)}
                onClick={() => onChange("install")}
              >
                {failed ? "Retry download" : names.install}
              </Button>
            ) : null}
            {downloading ? (
              // Cancelling stays reachable while other changes are blocked.
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange("cancel")}
              >
                Cancel download
              </Button>
            ) : null}
            {installed ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || Boolean(removeBlockedReason)}
                onClick={() => {
                  if (!confirmRemove) setConfirmRemove(true);
                  else {
                    setConfirmRemove(false);
                    onChange("remove");
                  }
                }}
              >
                {confirmRemove ? "Confirm removal" : names.remove}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {status ? (
        <p role="status" className="text-muted-foreground text-xs">
          {status}
        </p>
      ) : null}
      {downloading ? (
        <progress
          className="w-full"
          max={1}
          value={progress}
          aria-label={`${label} download progress`}
        />
      ) : null}
      {asset?.status === "failed" ? (
        <p role="status" className="text-muted-foreground text-xs">
          {assetFailureText(asset)}
        </p>
      ) : null}
      {!managed && !installed && !downloading && installBlocked ? (
        <p role="status" className="text-muted-foreground text-xs">
          {installBlocked}
        </p>
      ) : null}
      {!managed && installed && removeBlockedReason ? (
        <p role="status" className="text-muted-foreground text-xs">
          {removeBlockedReason}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Send one model change. Before a removal, this page's idle worker is
 * disposed and its use leases released (bounded wait), so the backend does not
 * refuse the removal for a lease this page no longer needs. A running
 * dictation session keeps its lease, and the backend refuses.
 */
export async function requestModelChange(
  operation: Change,
  assetId: string,
  {
    releaseIdleLeases,
    send,
  }: {
    releaseIdleLeases(): Promise<unknown>;
    send(request: { action: "install" | "remove"; assetId: string }): void;
  },
): Promise<void> {
  if (operation === "remove") await releaseIdleLeases();
  // Cancelling a download is a removal of its partial state.
  send({ action: operation === "install" ? "install" : "remove", assetId });
}

/**
 * Offline speech downloads for packaged desktop and built self-host. Vite
 * development serves the operator's host sets instead, so it shows how to
 * acquire them.
 */
export function OfflineSpeechDownloads({
  heading = true,
}: {
  heading?: boolean;
}) {
  if (!PARAKEET_DOWNLOADS_OFFERED)
    return (
      <p className="text-muted-foreground text-xs">
        This development stack serves speech models from the host: run python3
        scripts/models/parakeet.py acquire (and parakeet_webgpu.py acquire for
        GPU acceleration), then rerun reset.sh.
      </p>
    );
  return <OfflineSpeechDownloadsManager heading={heading} />;
}

function OfflineSpeechDownloadsManager({ heading }: { heading: boolean }) {
  return (
    <OfflineSpeechDownloadsView
      {...useOfflineSpeechDownloads()}
      heading={heading}
    />
  );
}

/**
 * The Parakeet sets' state and change actions, shared by Settings and the
 * setup Voice step: the model-asset list, a WebGPU probe that reruns when the
 * GPU set settles, and the last failed change.
 */
export function useOfflineSpeechDownloads(): Omit<
  OfflineSpeechDownloadsViewProps,
  "heading"
> {
  const assets = useModelAssets({ enabled: true });
  const capabilities = useRuntimeCapabilities();
  const operatorManaged = useOperatorManagedModels();
  const action = useModelAssetAction();
  const [gpuSupport, setGpuSupport] = useState<ParakeetWebgpuStatus | null>(
    null,
  );
  const [error, setError] = useState<{
    assetId: string;
    message: string;
  } | null>(null);
  const cpu = assets.data?.assets.find((item) => item.id === PARAKEET_ASSET_ID);
  const gpu = assets.data?.assets.find(
    (item) => item.id === PARAKEET_WEBGPU_ASSET_ID,
  );

  // Probe again whenever the GPU set settles; it installs without a reload.
  const gpuStatus = gpu?.status;
  useEffect(() => {
    let cancelled = false;
    void getParakeetWebgpuStatus({ refresh: true }).then((next) => {
      if (!cancelled) setGpuSupport(next);
    });
    return () => {
      cancelled = true;
    };
  }, [gpuStatus]);

  const change = (operation: Change, assetId: string) => {
    setError(null);
    return requestModelChange(operation, assetId, {
      releaseIdleLeases: disposeIdleClientParakeetWorker,
      send: (request) =>
        action.mutate(request, {
          onError: (cause) =>
            setError({ assetId, message: modelChangeErrorText(cause) }),
        }),
    });
  };

  return {
    cpu,
    gpu,
    freeBytes: assets.data?.free_bytes,
    gpuSupport,
    retryAssetIds: assets.retryAssetIds,
    pending: action.isPending || action.busy,
    blockedReason: action.blockedReason,
    error,
    gpuFellBack:
      getLastClientParakeetBackendState()?.fellBackFromWebgpu ?? false,
    listUnavailable: assets.isError,
    // Installed (a version is reported) yet disabled: the operator's flag.
    // Stale data from before an install reports no version.
    turnedOff:
      capabilities.data?.offline_speech_enabled === false &&
      Boolean(capabilities.data.offline_speech_asset_version),
    operatorManaged,
    onChange: (operation, assetId) => void change(operation, assetId),
  };
}
