import { useEffect, useState, type ReactNode } from "react";
import { getI18n, useTranslation } from "react-i18next";

import { useFormatters } from "@animama/product-ui/i18n";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

import parakeetWebgpuAttribution from "../../../../../../models/parakeet-tdt-0.6b-v2-webgpu/ATTRIBUTION.md?raw";
import senseVoiceAttribution from "../../../../../../models/sensevoice-small/ATTRIBUTION.md?raw";
import { offlineSpeechAssetIds } from "@/lib/speech/offline-stt/asset-ids";
import {
  OFFLINE_SPEECH_DOWNLOADS_OFFERED,
  offlineSttClients,
} from "@/lib/speech/offline-stt/clients";
import {
  routeOfflineSpeech,
  type OfflineSttEngine,
} from "@/lib/speech/offline-stt/routing";
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
import { Button } from "@/ui/components/button";
import { operatorManagedModelsNote } from "./operator-managed-models";

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
  support: WebgpuModelStatus | null;
}): string | null {
  const t = getI18n().getFixedT(null, "voice");
  if (!gpu) return t("offlineSpeech.gpu.blocked.missing");
  if (support === "unsupported") return t("offlineSpeech.gpu.blocked.noWebgpu");
  if (!cpuInstalled) return t("offlineSpeech.gpu.blocked.needsCpu");
  if (support === null) return t("offlineSpeech.gpu.blocked.checking");
  return null;
}

type Change = "install" | "cancel" | "remove";

/** The reviewed attribution each engine's downloads show. */
const ATTRIBUTIONS: Record<OfflineSttEngine, string> = {
  parakeet: parakeetWebgpuAttribution,
  sensevoice: senseVoiceAttribution,
};

/** How a Vite development stack acquires each engine's host sets. */
const ACQUIRE_COMMANDS: Record<OfflineSttEngine, { cpu: string; gpu: string }> =
  {
    parakeet: {
      cpu: "python3 scripts/models/parakeet.py acquire",
      gpu: "parakeet_webgpu.py acquire",
    },
    // Until Animama publishes the SenseVoice objects (gate G2).
    sensevoice: {
      cpu: "python3 scripts/models/sensevoice.py acquire --source upstream",
      gpu: "sensevoice_webgpu.py acquire",
    },
  };

/** The engines in display order: the one serving the UI Locale first. */
function offlineSpeechEngineOrder(
  locale: string | null | undefined,
): OfflineSttEngine[] {
  return routeOfflineSpeech(locale).engine === "parakeet"
    ? ["parakeet", "sensevoice"]
    : ["sensevoice", "parakeet"];
}

/** The languages an engine serves, its model and its attribution label. */
function engineText(engine: OfflineSttEngine) {
  const t = getI18n().getFixedT(null, "voice");
  return engine === "parakeet"
    ? {
        languages: t("offlineSpeech.engines.parakeet.languages"),
        model: t("offlineSpeech.engines.parakeet.model"),
        attribution: t("offlineSpeech.engines.parakeet.attribution"),
      }
    : {
        languages: t("offlineSpeech.engines.sensevoice.languages"),
        model: t("offlineSpeech.engines.sensevoice.model"),
        attribution: t("offlineSpeech.engines.sensevoice.attribution"),
      };
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
 * One offline engine's sets: the base (CPU) set with its GPU acceleration
 * add-on, installed in place by the backend model-asset service, under the
 * languages the engine serves. The add-on is always shown; when it cannot be
 * installed, its action is disabled with the reason. Operator-managed sets
 * show only their state.
 */
export function OfflineSpeechDownloadsView({
  engine,
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
  listLoaded = false,
  turnedOff = false,
  operatorManaged = false,
  onChange,
}: OfflineSpeechDownloadsViewProps) {
  const { t } = useTranslation("voice");
  const text = engineText(engine);
  // Without a list, the add-on's availability is still unknown.
  const listReady = listLoaded || cpu !== undefined || gpu !== undefined;
  const cpuInstalled = cpu?.status === "installed";
  // The backend refuses CPU removal while the add-on is installed or downloading.
  const gpuActive =
    gpu?.status === "installed" || gpu?.status === "downloading";
  const errorFor = (assetId: string) =>
    error?.assetId === assetId ? error.message : null;
  return (
    <section className="space-y-3" aria-label={text.languages}>
      <div className="space-y-0.5">
        <h4 className="text-sm font-medium">{text.languages}</h4>
        <p className="text-muted-foreground text-xs">{text.model}</p>
      </div>
      {turnedOff && cpuInstalled ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("offlineSpeech.turnedOff")}
        </p>
      ) : null}
      {operatorManaged ? (
        <p className="text-muted-foreground text-xs">
          {operatorManagedModelsNote()}
        </p>
      ) : null}
      {cpu ? (
        <ModelSetRow
          label={t("offlineSpeech.cpu.label")}
          asset={cpu}
          managed={operatorManaged}
          names={{
            install: t("offlineSpeech.cpu.download"),
            remove: t("offlineSpeech.cpu.remove"),
          }}
          freeBytes={freeBytes}
          retry={retryAssetIds?.has(cpu.id) ?? false}
          pending={pending}
          installBlockedReason={blockedReason ?? null}
          removeBlockedReason={
            gpuActive ? t("offlineSpeech.gpu.removeFirst") : null
          }
          error={errorFor(cpu.id)}
          onChange={(change) => onChange(change, cpu.id)}
        />
      ) : (
        <p role="status" className="text-muted-foreground text-xs">
          {listUnavailable
            ? t("offlineSpeech.listUnavailable")
            : listReady
              ? t("downloads.notAvailable")
              : t("offlineSpeech.checking")}
        </p>
      )}
      <div className="border-border/60 space-y-2 border-l-2 pl-3">
        <ModelSetRow
          label={t("offlineSpeech.gpu.label")}
          description={t("offlineSpeech.gpu.description")}
          asset={gpu}
          managed={operatorManaged}
          names={{
            install: t("offlineSpeech.gpu.download"),
            remove: t("offlineSpeech.gpu.remove"),
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
                ? t("offlineSpeech.gpu.unavailableNow")
                : t("offlineSpeech.checking")
          }
          removeBlockedReason={null}
          error={gpu ? errorFor(gpu.id) : null}
          installedNote={
            gpuFellBack ? t("offlineSpeech.gpu.fellBack") : undefined
          }
          onChange={(change) => gpu && onChange(change, gpu.id)}
        >
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer">
              {text.attribution}
            </summary>
            {/* Plain text keeps the reviewed notice compact inside a settings row. */}
            <pre className="text-muted-foreground mt-2 font-sans text-xs whitespace-pre-wrap">
              {ATTRIBUTIONS[engine].trim()}
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
  const { t } = useTranslation("voice");
  const { fileSize, number } = useFormatters();
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
      ? t("downloads.lowSpace", { size: fileSize(asset.required_free_bytes) })
      : null);
  const status = !asset
    ? null
    : installed
      ? installedNote
        ? t("downloads.installedWithNote", { note: installedNote })
        : t("downloads.installed")
      : downloading
        ? progress === 1
          ? t("downloads.verifying")
          : t("downloads.downloading", {
              percent: number(progress ?? 0, {
                style: "percent",
                maximumFractionDigits: 0,
              }),
            })
        : managed
          ? t("downloads.notAvailable")
          : t("downloads.size", { size: fileSize(asset.size_bytes) });
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
                {failed ? t("downloads.retry") : names.install}
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
                {t("downloads.cancel")}
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
                {confirmRemove ? t("downloads.confirmRemoval") : names.remove}
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
          aria-label={t("downloads.progressLabel", { label })}
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
 * Offline speech downloads for packaged desktop and built self-host: each
 * engine's sets, the one serving the UI Locale first (`routedOnly` shows only
 * that one). Vite development serves the operator's host sets instead, so it
 * shows how to acquire them.
 */
export function OfflineSpeechDownloads({
  heading = true,
  routedOnly = false,
}: {
  heading?: boolean;
  routedOnly?: boolean;
}) {
  // Read through `i18n` so the order follows a language switch.
  const { t, i18n } = useTranslation("voice");
  const engines = offlineSpeechEngineOrder(i18n.resolvedLanguage);
  return (
    <section className="space-y-4" aria-label={t("offlineSpeech.title")}>
      {heading ? (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t("offlineSpeech.title")}</h3>
          <p className="text-muted-foreground text-xs">
            {t("offlineSpeech.description")}
          </p>
        </div>
      ) : null}
      {(routedOnly ? engines.slice(0, 1) : engines).map((engine) =>
        OFFLINE_SPEECH_DOWNLOADS_OFFERED ? (
          <OfflineSpeechDownloadsManager key={engine} engine={engine} />
        ) : (
          <HostSpeechModelsNote key={engine} engine={engine} />
        ),
      )}
    </section>
  );
}

/** How a Vite development stack acquires an engine's host sets. */
function HostSpeechModelsNote({ engine }: { engine: OfflineSttEngine }) {
  const { t } = useTranslation("voice");
  return (
    <section className="space-y-0.5" aria-label={engineText(engine).languages}>
      <h4 className="text-sm font-medium">{engineText(engine).languages}</h4>
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

function OfflineSpeechDownloadsManager({
  engine,
}: {
  engine: OfflineSttEngine;
}) {
  return <OfflineSpeechDownloadsView {...useOfflineSpeechDownloads(engine)} />;
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
