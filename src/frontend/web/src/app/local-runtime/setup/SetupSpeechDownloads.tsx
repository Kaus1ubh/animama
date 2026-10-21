import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { useFormatters } from "@animama/product-ui/i18n";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { OFFLINE_SPEECH_DOWNLOADS_OFFERED } from "@/lib/speech/offline-stt/clients";
import {
  routeOfflineSpeech,
  type OfflineSttEngine,
} from "@/lib/speech/offline-stt/routing";
import { Button } from "@/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import {
  assetFailureText,
  OfflineSpeechDownloads,
  useOfflineSpeechDownloads,
  type OfflineSpeechDownloadsViewProps,
} from "@/ui/settings/OfflineSpeechDownloads";

import { ModelLink } from "./ModelLink";

type SpeechSet = "cpu" | "gpu";

/** Each engine's model name in tab labels and its public model page. */
const ENGINE_MODELS: Record<
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
 * Setup's Speech-to-Text choice: the CPU set and GPU add-on of the engine for
 * the UI Locale (Parakeet for English, SenseVoice otherwise) as two tabs, each
 * with one download action. Downloads are backend-owned and keep running
 * after setup; removal, attribution and the other language's sets live in App
 * Settings. Vite development serves host sets instead, so it shows how to
 * acquire them.
 */
export function SetupSpeechDownloads() {
  // Read through `i18n` so the offer follows a language switch.
  const { i18n } = useTranslation("setup");
  const engine = routeOfflineSpeech(i18n.resolvedLanguage).engine;
  if (!OFFLINE_SPEECH_DOWNLOADS_OFFERED)
    return <OfflineSpeechDownloads routedOnly />;
  return <SetupSpeechDownloadsManager key={engine} engine={engine} />;
}

function SetupSpeechDownloadsManager({ engine }: { engine: OfflineSttEngine }) {
  return <SetupSpeechDownloadsView {...useOfflineSpeechDownloads(engine)} />;
}

/** The tabbed view, separate from the download state it renders. */
function SetupSpeechDownloadsView({
  engine,
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
  onChange,
}: OfflineSpeechDownloadsViewProps) {
  const { t } = useTranslation("setup");
  const { fileSize } = useFormatters();
  const [tab, setTab] = useState<SpeechSet>("cpu");
  // Asking for the GPU add-on before its CPU prerequisite shows why it waits.
  const [needsCpu, setNeedsCpu] = useState(false);
  const cpuInstalled = cpu?.status === "installed";
  const model = ENGINE_MODELS[engine];
  /** A set's tab label, with its download size once known. */
  const label = (set: SpeechSet, asset: PyModelAssetState | undefined) => {
    if (!asset)
      return set === "cpu"
        ? t("voice.stt.cpu.label", { model: model.name })
        : t("voice.stt.gpu.label", { model: model.name });
    const size = fileSize(asset.size_bytes);
    return set === "cpu"
      ? t("voice.stt.cpu.labelWithSize", { model: model.name, size })
      : t("voice.stt.gpu.labelWithSize", { model: model.name, size });
  };
  const errorFor = (asset: PyModelAssetState | undefined) =>
    asset && error?.assetId === asset.id ? error.message : null;

  if (!cpu && !gpu)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {listUnavailable
          ? t("voice.stt.listUnavailable")
          : t("voice.stt.checking")}
      </p>
    );

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as SpeechSet)}>
      <TabsList
        variant="underline"
        aria-label={t("voice.stt.models")}
        className="w-fit max-w-full"
      >
        {(
          [
            ["cpu", label("cpu", cpu)],
            ["gpu", label("gpu", gpu)],
          ] as const
        ).map(([id, text]) => (
          <TabsTrigger
            key={id}
            value={id}
            variant="underline"
            className={underlineTabClassName(tab === id)}
          >
            {text}
          </TabsTrigger>
        ))}
      </TabsList>
      {turnedOff && cpuInstalled ? (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          {t("voice.stt.turnedOff")}
        </p>
      ) : null}
      <TabsContent value="cpu" className="mt-4 space-y-3">
        <p className="text-muted-foreground text-sm">
          <Trans
            t={t}
            i18nKey={
              engine === "parakeet"
                ? "voice.stt.engines.parakeet"
                : "voice.stt.engines.sensevoice"
            }
            components={{ link: <ModelLink href={model.source} /> }}
          />
        </p>
        <SetupModelSet
          label={t("voice.stt.cpu.label", { model: model.name })}
          asset={cpu}
          freeBytes={freeBytes}
          retry={cpu ? (retryAssetIds?.has(cpu.id) ?? false) : false}
          disabled={pending || Boolean(blockedReason)}
          note={blockedReason ?? null}
          error={errorFor(cpu)}
          onInstall={() => {
            setNeedsCpu(false);
            if (cpu) onChange("install", cpu.id);
          }}
          onCancel={() => cpu && onChange("cancel", cpu.id)}
        />
      </TabsContent>
      <TabsContent value="gpu" className="mt-4 space-y-3">
        <p className="text-muted-foreground text-sm">
          {t("voice.stt.gpu.description")}
        </p>
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
          onInstall={() => {
            if (!cpuInstalled) return setNeedsCpu(true);
            if (gpu) onChange("install", gpu.id);
          }}
          onCancel={() => gpu && onChange("cancel", gpu.id)}
        >
          <WebgpuCheck support={gpuSupport} />
        </SetupModelSet>
      </TabsContent>
    </Tabs>
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
  onInstall,
  onCancel,
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
  onInstall: () => void;
  onCancel: () => void;
  /** Extra status lines, such as the WebGPU check. */
  children?: ReactNode;
}) {
  const { t } = useTranslation("setup");
  const { fileSize, number } = useFormatters();
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
        {downloading ? (
          // Cancelling stays reachable while other changes are blocked.
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t("actions.cancel")}
          </Button>
        ) : installed ? null : (
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
      {!installed && !downloading && note ? (
        <p role="status" className="text-muted-foreground text-xs">
          {note}
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
