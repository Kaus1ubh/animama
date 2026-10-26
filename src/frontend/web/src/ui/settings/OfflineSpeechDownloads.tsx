import { useEffect, useState } from "react";
import { getI18n, useTranslation } from "react-i18next";

import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import { offlineSpeechAssetIds } from "@/lib/speech/offline-stt/asset-ids";
import { offlineSttClients } from "@/lib/speech/offline-stt/clients";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import type { WebgpuModelStatus } from "@/lib/speech/offline-stt/webgpu";
import {
  useModelAssets,
  useOperatorManagedModelAssets,
} from "@/query/hooks/useModelAssets";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import {
  DownloadGuardError,
  downloadGuardText,
} from "@/query/model-download-coordination";

/**
 * Why a failed download stopped, from its stable failure code (the model-asset
 * API never sends paths).
 */
export function assetFailureText(asset: PyModelAssetState): string {
  const t = getI18n().getFixedT(null, "voice");
  switch (asset.reason) {
    case "asset_download_failed":
      return t("offlineSpeech.failures.downloadFailed");
    case "asset_host_not_allowed":
      return t("offlineSpeech.failures.hostNotAllowed");
    case "asset_size_invalid":
      return t("offlineSpeech.failures.sizeInvalid");
    case "asset_hash_invalid":
      return t("offlineSpeech.failures.hashInvalid");
    case "asset_store_failed":
      return t("offlineSpeech.failures.storeFailed");
    case "asset_insufficient_space":
      return t("offlineSpeech.failures.insufficientSpace");
    default:
      return t("offlineSpeech.failures.unknown");
  }
}

/**
 * A readable message for a failed model change, never a raw payload. Refusals
 * (HTTP 409 `detail.code`) have their own wording.
 */
export function modelChangeErrorText(error: unknown): string {
  if (error instanceof DownloadGuardError)
    return downloadGuardText(error.reason);
  const t = getI18n().getFixedT(null, "voice");
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: { code?: unknown } }).detail
      : undefined;
  switch (detail?.code) {
    case "model_asset_in_use":
      return t("offlineSpeech.refusals.inUse");
    case "model_asset_required_by":
      return t("offlineSpeech.gpu.removeFirst");
    case "model_asset_requires":
      return t("offlineSpeech.gpu.blocked.needsCpu");
    case "model_asset_busy":
      return t("offlineSpeech.refusals.busy");
    default:
      return t("offlineSpeech.refusals.changeFailed");
  }
}

type Change = "install" | "cancel" | "remove";

/** How a Vite development stack acquires each engine's host sets. */
const ACQUIRE_COMMANDS: Record<OfflineSttEngine, { cpu: string; gpu: string }> =
  {
    parakeet: {
      cpu: "python3 scripts/models/parakeet.py acquire",
      gpu: "parakeet_webgpu.py acquire",
    },
    sensevoice: {
      cpu: "python3 scripts/models/sensevoice.py acquire",
      gpu: "sensevoice_webgpu.py acquire",
    },
  };

/** The languages an engine serves, which head its section. */
function engineLanguages(engine: OfflineSttEngine): string {
  const t = getI18n().getFixedT(null, "voice");
  return engine === "parakeet"
    ? t("offlineSpeech.engines.parakeet.languages")
    : t("offlineSpeech.engines.sensevoice.languages");
}

export type OfflineSpeechDownloadsViewProps = {
  /** The engine whose sets these are. */
  engine: OfflineSttEngine;
  cpu: PyModelAssetState | undefined;
  gpu: PyModelAssetState | undefined;
  freeBytes?: number | null;
  /** WebGPU probe result; `null` while probing. */
  gpuSupport: WebgpuModelStatus | null;
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
  /**
   * The list has loaded; a set it does not contain is not offered by this
   * runtime (for example a hosted operator that provides only some engines).
   */
  listLoaded?: boolean;
  /** The server operator turned offline speech off, even with sets installed. */
  turnedOff?: boolean;
  /** The operator provides the sets; show their state without actions. */
  operatorManaged?: boolean;
  onChange(change: Change, assetId: string): void;
};

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

/** How a Vite development stack acquires an engine's host sets. */
export function HostSpeechModelsNote({ engine }: { engine: OfflineSttEngine }) {
  const { t } = useTranslation("voice");
  return (
    <section className="space-y-0.5" aria-label={engineLanguages(engine)}>
      <h4 className="text-sm font-medium">{engineLanguages(engine)}</h4>
      <p className="text-muted-foreground text-xs">
        {t("offlineSpeech.developmentAcquire", {
          cpuCommand: ACQUIRE_COMMANDS[engine].cpu,
          gpuCommand: ACQUIRE_COMMANDS[engine].gpu,
          resetCommand: "reset.sh",
        })}
      </p>
    </section>
  );
}

/**
 * One engine's sets' state and change actions, shared by Settings and the
 * setup Voice step: the model-asset list, a WebGPU probe that reruns when the
 * GPU set settles, and the last failed change.
 */
export function useOfflineSpeechDownloads(
  engine: OfflineSttEngine,
): OfflineSpeechDownloadsViewProps {
  // Rerender on a UI Locale change, which rewords the blocked reason and error.
  useTranslation("voice");
  const assets = useModelAssets({ enabled: true });
  const capabilities = useRuntimeCapabilities();
  const operatorManaged = useOperatorManagedModelAssets();
  const action = useModelAssetAction();
  const client = offlineSttClients[engine];
  const ids = offlineSpeechAssetIds[engine];
  const [gpuSupport, setGpuSupport] = useState<WebgpuModelStatus | null>(null);
  // The cause is kept so its wording follows the UI Locale.
  const [error, setError] = useState<{
    assetId: string;
    cause: unknown;
  } | null>(null);
  const cpu = assets.data?.assets.find((item) => item.id === ids.base);
  const gpu = assets.data?.assets.find((item) => item.id === ids.gpu);

  // Probe again whenever the GPU set settles; it installs without a reload.
  const gpuStatus = gpu?.status;
  useEffect(() => {
    let cancelled = false;
    void client.getWebgpuStatus({ refresh: true }).then((next) => {
      if (!cancelled) setGpuSupport(next);
    });
    return () => {
      cancelled = true;
    };
  }, [client, gpuStatus]);

  const change = (operation: Change, assetId: string) => {
    setError(null);
    return requestModelChange(operation, assetId, {
      releaseIdleLeases: client.disposeIdle,
      send: (request) =>
        action.mutate(request, {
          onError: (cause) => setError({ assetId, cause }),
        }),
    });
  };

  const data = capabilities.data;
  const [enabled, version] =
    engine === "parakeet"
      ? [data?.offline_speech_enabled, data?.offline_speech_asset_version]
      : [
          data?.offline_multilingual_speech_enabled,
          data?.offline_multilingual_speech_asset_version,
        ];
  return {
    engine,
    cpu,
    gpu,
    freeBytes: assets.data?.free_bytes,
    gpuSupport,
    retryAssetIds: assets.retryAssetIds,
    pending: action.isPending || action.busy,
    blockedReason: action.blockedReason,
    error: error && {
      assetId: error.assetId,
      message: modelChangeErrorText(error.cause),
    },
    gpuFellBack: client.getLastBackendState()?.fellBackFromWebgpu ?? false,
    listUnavailable: assets.isError,
    listLoaded: assets.data !== undefined,
    // Installed (a version is reported) yet disabled: the operator's flag.
    // Stale data from before an install reports no version.
    turnedOff: enabled === false && Boolean(version),
    operatorManaged,
    onChange: (operation, assetId) => void change(operation, assetId),
  };
}
