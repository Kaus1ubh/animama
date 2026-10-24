import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { useFormatters } from "@animama/product-ui/i18n";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import type { SetupSttChoice } from "@/app/local-runtime/setup-draft";
import { OFFLINE_SPEECH_DOWNLOADS_OFFERED } from "@/lib/speech/offline-stt/clients";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import type { SttProviderOption } from "@/lib/speech/stt-provider";
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
  HostSpeechModelsNote,
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

type BrowserChoice = Extract<
  SetupSttChoice,
  "browser_external" | "browser_local"
>;
const isBrowserChoice = (choice: SetupSttChoice): choice is BrowserChoice =>
  choice === "browser_external" || choice === "browser_local";
/** An offline tab's engine and set, from its id (`sensevoice_gpu`). */
const offlineChoice = (choice: Exclude<SetupSttChoice, BrowserChoice>) => {
  const [engine, set] = choice.split("_") as [OfflineSttEngine, SpeechSet];
  return { engine, set };
};

/**
 * Setup's Speech-to-Text choice, one tab per option: the UI Locale's offline
 * model on the CPU (recommended) and GPU, the other offline model, and on the
 * web the browser recognizers. The selected tab is saved at Finish. Offline
 * tabs offer their set's download, which is backend-owned and keeps running
 * after setup; removal and attribution live in App Settings. Vite development
 * serves host sets instead, so it shows how to acquire them.
 */
export function SetupSpeechChoice({
  choice,
  choices,
  engine,
  browserOptions,
  onChoiceChange,
}: {
  choice: SetupSttChoice;
  choices: readonly SetupSttChoice[];
  /** The UI Locale's offline engine, whose CPU tab is recommended. */
  engine: OfflineSttEngine;
  /** The browser recognizers' labels, descriptions and availability. */
  browserOptions: readonly SttProviderOption[];
  onChoiceChange: (choice: SetupSttChoice) => void;
}) {
  const { t } = useTranslation("setup");
  const { fileSize } = useFormatters();
  const downloads = {
    parakeet: useOfflineSpeechDownloads("parakeet"),
    sensevoice: useOfflineSpeechDownloads("sensevoice"),
  };
  const browserOption = (id: BrowserChoice) =>
    browserOptions.find((option) => option.id === id);
  /** A tab's label: the model and set, with its download size once known. */
  const label = (option: SetupSttChoice) => {
    if (isBrowserChoice(option)) return browserOption(option)?.label ?? option;
    const { engine: tabEngine, set } = offlineChoice(option);
    const model = ENGINE_MODELS[tabEngine].name;
    const asset = downloads[tabEngine][set];
    if (!asset || !OFFLINE_SPEECH_DOWNLOADS_OFFERED)
      return set === "cpu"
        ? t("voice.stt.cpu.label", { model })
        : t("voice.stt.gpu.label", { model });
    const size = fileSize(asset.size_bytes);
    return set === "cpu"
      ? t("voice.stt.cpu.labelWithSize", { model, size })
      : t("voice.stt.gpu.labelWithSize", { model, size });
  };
  const unavailable = choices.flatMap((option) => {
    const browser = isBrowserChoice(option) ? browserOption(option) : null;
    return browser?.disabled && browser.reason ? [browser] : [];
  });

  return (
    <Tabs
      value={choice}
      onValueChange={(value) => onChoiceChange(value as SetupSttChoice)}
    >
      <TabsList
        variant="underline"
        aria-label={t("voice.stt.models")}
        className="h-auto w-fit max-w-full flex-wrap"
      >
        {choices.map((option) => {
          const browser = isBrowserChoice(option)
            ? browserOption(option)
            : null;
          return (
            <TabsTrigger
              key={option}
              value={option}
              variant="underline"
              // A recognizer this browser cannot run is not offered.
              disabled={browser?.disabled}
              title={browser?.disabled ? browser.reason : undefined}
              className={underlineTabClassName(choice === option)}
            >
              {label(option)}
              {option === `${engine}_cpu` ? (
                <span className="text-muted-foreground ms-1.5 text-xs font-normal">
                  {t("voice.stt.recommended")}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {/* A disabled tab cannot take focus, so its reason is shown here. */}
      {unavailable.map((option) => (
        <p key={option.id} className="text-muted-foreground mt-2 text-xs">
          {t("voice.tts.unavailableReason", {
            provider: option.label,
            reason: option.reason ?? "",
          })}
        </p>
      ))}
      {choices.map((option) => (
        <TabsContent key={option} value={option} className="mt-4 space-y-3">
          {isBrowserChoice(option) ? (
            <p className="text-muted-foreground text-sm">
              {browserOption(option)?.description}
            </p>
          ) : (
            <OfflineChoicePanel
              {...offlineChoice(option)}
              routed={offlineChoice(option).engine === engine}
              downloads={downloads[offlineChoice(option).engine]}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/**
 * One offline tab: what the model does, when the app uses it, and its set's
 * download (or, in Vite development, how to acquire it).
 */
function OfflineChoicePanel({
  engine,
  set,
  routed,
  downloads,
}: {
  engine: OfflineSttEngine;
  set: SpeechSet;
  /** The model serves the UI Locale. */
  routed: boolean;
  downloads: OfflineSpeechDownloadsViewProps;
}) {
  const { t } = useTranslation("setup");
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
    onChange,
  } = downloads;
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
      onInstall={() => cpu && onChange("install", cpu.id)}
      onCancel={() => cpu && onChange("cancel", cpu.id)}
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
      onInstall={() => {
        if (!cpuInstalled) return setNeedsCpu(true);
        if (gpu) onChange("install", gpu.id);
      }}
      onCancel={() => gpu && onChange("cancel", gpu.id)}
    >
      <WebgpuCheck support={gpuSupport} />
    </SetupModelSet>
  );

  return (
    <>
      <p className="text-muted-foreground text-sm">{description}</p>
      {routed ? null : (
        <p className="text-muted-foreground text-sm">
          {engine === "parakeet"
            ? t("voice.stt.otherLanguage.parakeet")
            : t("voice.stt.otherLanguage.sensevoice")}
        </p>
      )}
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
