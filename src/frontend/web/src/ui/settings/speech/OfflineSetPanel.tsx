import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { useFormatters } from "@animama/product-ui/i18n";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { OFFLINE_SPEECH_DOWNLOADS_OFFERED } from "@/lib/speech/offline-stt/clients";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import { Button } from "@/ui/components/button";
import { ModelLink } from "@/ui/components/model-link";
import {
  assetFailureText,
  HostSpeechModelsNote,
  type OfflineSpeechDownloadsViewProps,
} from "@/ui/settings/OfflineSpeechDownloads";
import { operatorManagedModelsNote } from "@/ui/settings/operator-managed-models";

/** An offline engine's two sets: the CPU model and its GPU add-on. */
export type SpeechSet = "cpu" | "gpu";

/** Each engine's model name in tab labels and its public model page. */
export const ENGINE_MODELS: Record<
  OfflineSttEngine,
  { name: string; source: string }
> = {
  parakeet: {
    name: "Parakeet",
    source: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2",
  },
  sensevoice: {
    name: "SenseVoice",
    source: "https://huggingface.co/FunAudioLLM/SenseVoiceSmall",
  },
};

/**
 * One offline engine's CPU or GPU version, shared by setup and App Settings:
 * what the model does, which languages it recognizes, its set's ✓/✗ state with
 * download, cancel and retry, and for the GPU set a WebGPU ✓/✗ check (or, in
 * Vite development, how to acquire the set). `manage` adds what App Settings
 * offers: confirmed removal, the WebGPU fallback note and operator-managed
 * sets shown without actions.
 */
export function OfflineSetPanel({
  engine,
  set,
  downloads,
  manage = false,
}: {
  engine: OfflineSttEngine;
  set: SpeechSet;
  downloads: OfflineSpeechDownloadsViewProps;
  manage?: boolean;
}) {
  const { t } = useTranslation("setup");
  const { t: tVoice } = useTranslation("voice");
  // Asking for the GPU add-on before its CPU prerequisite shows why it waits.
  const [needsCpu, setNeedsCpu] = useState(false);
  const {
    cpu,
    gpu,
    freeBytes,
    gpuSupport,
    retryAssetIds,
    pending,
    blockedReason,
    error,
    listUnavailable = false,
    turnedOff = false,
    gpuFellBack = false,
    operatorManaged = false,
    onChange,
  } = downloads;
  const managed = manage && operatorManaged;
  // The backend refuses CPU removal while the add-on is installed or downloading.
  const gpuActive =
    gpu?.status === "installed" || gpu?.status === "downloading";
  const model = ENGINE_MODELS[engine];
  const cpuInstalled = cpu?.status === "installed";
  const errorFor = (asset: PyModelAssetState | undefined) =>
    asset && error?.assetId === asset.id ? error.message : null;

  const description =
    set === "cpu" ? (
      <Trans
        t={t}
        i18nKey={
          engine === "parakeet"
            ? "voice.stt.engines.parakeet"
            : "voice.stt.engines.sensevoice"
        }
        components={{ link: <ModelLink href={model.source} /> }}
      />
    ) : (
      t("voice.stt.gpu.description")
    );
  const download = !OFFLINE_SPEECH_DOWNLOADS_OFFERED ? (
    <HostSpeechModelsNote engine={engine} />
  ) : !cpu && !gpu ? (
    <p role="status" className="text-muted-foreground text-sm">
      {listUnavailable
        ? t("voice.stt.listUnavailable")
        : t("voice.stt.checking")}
    </p>
  ) : set === "cpu" ? (
    <SetupModelSet
      label={t("voice.stt.cpu.label", { model: model.name })}
      asset={cpu}
      freeBytes={freeBytes}
      retry={cpu ? (retryAssetIds?.has(cpu.id) ?? false) : false}
      disabled={pending || Boolean(blockedReason)}
      note={blockedReason ?? null}
      error={errorFor(cpu)}
      managed={managed}
      onInstall={() => cpu && onChange("install", cpu.id)}
      onCancel={() => cpu && onChange("cancel", cpu.id)}
      onRemove={manage ? () => cpu && onChange("remove", cpu.id) : undefined}
      removeBlockedReason={
        gpuActive ? tVoice("offlineSpeech.gpu.removeFirst") : null
      }
    />
  ) : (
    <SetupModelSet
      label={t("voice.stt.gpu.label", { model: model.name })}
      asset={gpu}
      freeBytes={freeBytes}
      retry={gpu ? (retryAssetIds?.has(gpu.id) ?? false) : false}
      // Wait for the WebGPU check, so an unusable set is never fetched.
      disabled={
        pending ||
        Boolean(blockedReason) ||
        gpuSupport === null ||
        gpuSupport === "unsupported"
      }
      note={
        needsCpu && !cpuInstalled
          ? t("voice.stt.gpu.needsCpu")
          : (blockedReason ?? null)
      }
      error={errorFor(gpu)}
      managed={managed}
      installedNote={
        manage && gpuFellBack ? tVoice("offlineSpeech.gpu.fellBack") : null
      }
      onInstall={() => {
        if (!cpuInstalled) return setNeedsCpu(true);
        if (gpu) onChange("install", gpu.id);
      }}
      onCancel={() => gpu && onChange("cancel", gpu.id)}
      onRemove={manage ? () => gpu && onChange("remove", gpu.id) : undefined}
    >
      <WebgpuCheck support={gpuSupport} />
    </SetupModelSet>
  );

  return (
    <>
      <p className="text-muted-foreground text-sm">{description}</p>
      {/* Either engine runs in any app language (ADR 0031). */}
      <p className="text-muted-foreground text-sm">
        {engine === "parakeet"
          ? t("voice.stt.recognizes.parakeet")
          : t("voice.stt.recognizes.sensevoice")}
      </p>
      {managed ? (
        <p className="text-muted-foreground text-sm">
          {operatorManagedModelsNote()}
        </p>
      ) : null}
      {turnedOff && cpuInstalled ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("voice.stt.turnedOff")}
        </p>
      ) : null}
      {download}
    </>
  );
}

/** A ✓ or ✗ status line, such as "Downloaded" or "WebGPU available". */
function StatusCheck({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm">
      {ok ? (
        <Check className="text-success size-4" aria-hidden />
      ) : (
        <X className="text-muted-foreground size-4" aria-hidden />
      )}
      {children}
    </p>
  );
}

/** Whether this device can run the GPU set. */
function WebgpuCheck({
  support,
}: {
  support: OfflineSpeechDownloadsViewProps["gpuSupport"];
}) {
  const { t } = useTranslation("setup");
  if (support === null)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("voice.stt.webgpu.checking")}
      </p>
    );
  // "model_missing" means WebGPU works; only the set is not installed yet.
  const available = support !== "unsupported";
  return (
    <StatusCheck ok={available}>
      {available
        ? t("voice.stt.webgpu.available")
        : t("voice.stt.webgpu.unavailable")}
    </StatusCheck>
  );
}

/** One downloadable set: its state on the left, one action on the right. */
function SetupModelSet({
  label,
  asset,
  freeBytes,
  retry,
  disabled,
  note,
  error,
  managed = false,
  installedNote = null,
  removeBlockedReason = null,
  onInstall,
  onCancel,
  onRemove,
  children,
}: {
  label: string;
  asset: PyModelAssetState | undefined;
  freeBytes?: number | null;
  retry: boolean;
  disabled: boolean;
  /** Why the download is waiting, shown under the row. */
  note: string | null;
  error: string | null;
  /** Provided by the operator: state only, no actions. */
  managed?: boolean;
  /** Shown under an installed set, such as the WebGPU fallback. */
  installedNote?: string | null;
  /** Why an installed set cannot be removed yet. */
  removeBlockedReason?: string | null;
  onInstall: () => void;
  onCancel: () => void;
  /** Offered for an installed set, with a confirmation click. */
  onRemove?: () => void;
  /** Extra status lines, such as the WebGPU check. */
  children?: ReactNode;
}) {
  const { t } = useTranslation("setup");
  const { t: tVoice } = useTranslation("voice");
  const { fileSize, number } = useFormatters();
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (!asset)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("voice.stt.unavailableInBuild")}
      </p>
    );
  const installed = asset.status === "installed";
  const downloading = asset.status === "downloading";
  const failed = asset.status === "failed" || retry;
  // Without a known total, an indeterminate bar (no value) shows activity.
  const progress =
    downloading && asset.total_bytes
      ? Math.min(1, (asset.bytes_downloaded ?? 0) / asset.total_bytes)
      : undefined;
  const lowSpace =
    !installed &&
    !downloading &&
    typeof freeBytes === "number" &&
    freeBytes < asset.required_free_bytes;
  return (
    <div className="space-y-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {children}
          {installed ? (
            <StatusCheck ok>{t("voice.stt.downloaded")}</StatusCheck>
          ) : downloading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {progress === 1
                ? t("voice.stt.verifying")
                : t("voice.stt.downloading", {
                    percent: number(progress ?? 0, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    }),
                  })}
            </p>
          ) : (
            <StatusCheck ok={false}>{t("voice.stt.notDownloaded")}</StatusCheck>
          )}
        </div>
        {managed ? null : downloading ? (
          // Cancelling stays reachable while other changes are blocked.
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t("actions.cancel")}
          </Button>
        ) : installed ? (
          onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || Boolean(removeBlockedReason)}
              onClick={() => {
                if (!confirmRemove) return setConfirmRemove(true);
                setConfirmRemove(false);
                onRemove();
              }}
            >
              {confirmRemove
                ? tVoice("downloads.confirmRemoval")
                : tVoice("downloads.remove")}
            </Button>
          ) : null
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || lowSpace}
            onClick={onInstall}
          >
            {failed ? t("voice.stt.retryDownload") : t("voice.stt.download")}
          </Button>
        )}
      </div>
      {downloading ? (
        <progress
          className="w-full"
          max={1}
          value={progress}
          aria-label={t("voice.stt.progressLabel", { label })}
        />
      ) : null}
      {asset.status === "failed" ? (
        <p role="status" className="text-muted-foreground text-xs">
          {assetFailureText(asset)}
        </p>
      ) : null}
      {lowSpace ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("voice.stt.lowSpace", {
            size: fileSize(asset.required_free_bytes),
          })}
        </p>
      ) : null}
      {!managed && !installed && !downloading && note ? (
        <p role="status" className="text-muted-foreground text-xs">
          {note}
        </p>
      ) : null}
      {installed && installedNote ? (
        <p role="status" className="text-muted-foreground text-xs">
          {installedNote}
        </p>
      ) : null}
      {installed && onRemove && removeBlockedReason ? (
        <p role="status" className="text-muted-foreground text-xs">
          {removeBlockedReason}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
