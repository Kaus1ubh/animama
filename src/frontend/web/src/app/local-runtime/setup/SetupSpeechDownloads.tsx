import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";

import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { PARAKEET_DOWNLOADS_OFFERED } from "@/lib/speech/client-parakeet/assets";
import { formatFileSize } from "@/lib/user-files/uploads";
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

/**
 * Setup's Speech-to-Text choice: Parakeet's CPU set and its GPU add-on as two
 * tabs, each with one download action. Downloads are backend-owned and keep
 * running after setup; removal and attribution live in App Settings. Vite
 * development serves host sets instead, so it shows how to acquire them.
 */
export function SetupSpeechDownloads() {
  if (!PARAKEET_DOWNLOADS_OFFERED) return <OfflineSpeechDownloads />;
  return <SetupSpeechDownloadsManager />;
}

function SetupSpeechDownloadsManager() {
  return <SetupSpeechDownloadsView {...useOfflineSpeechDownloads()} />;
}

/** The tabbed view, separate from the download state it renders. */
function SetupSpeechDownloadsView({
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
}: Omit<OfflineSpeechDownloadsViewProps, "heading">) {
  const [tab, setTab] = useState<SpeechSet>("cpu");
  // Asking for the GPU add-on before its CPU prerequisite shows why it waits.
  const [needsCpu, setNeedsCpu] = useState(false);
  const cpuInstalled = cpu?.status === "installed";
  const label = (kind: string, asset: PyModelAssetState | undefined) =>
    asset
      ? `Parakeet (${kind}, ${formatFileSize(asset.size_bytes)})`
      : `Parakeet (${kind})`;
  const errorFor = (asset: PyModelAssetState | undefined) =>
    asset && error?.assetId === asset.id ? error.message : null;

  if (!cpu && !gpu)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {listUnavailable
          ? "Speech downloads are unavailable right now. You can add them later in App Settings."
          : "Checking speech recognition…"}
      </p>
    );

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as SpeechSet)}>
      <TabsList
        variant="underline"
        aria-label="Speech recognition models"
        className="w-fit max-w-full"
      >
        {(
          [
            ["cpu", label("CPU", cpu)],
            ["gpu", label("GPU", gpu)],
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
          Speech recognition is turned off on this server.
        </p>
      ) : null}
      <TabsContent value="cpu" className="mt-4 space-y-3">
        <p className="text-muted-foreground text-sm">
          <ModelLink href="https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2">
            NVIDIA&apos;s Parakeet TDT 0.6B v2
          </ModelLink>{" "}
          transcribes English speech on this device, so your voice never leaves
          it.
        </p>
        <SetupModelSet
          label="Parakeet (CPU)"
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
          Faster, with live previews as you speak. Needs the CPU version and a
          WebGPU-capable GPU.
        </p>
        <SetupModelSet
          label="Parakeet (GPU)"
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
              ? "Download the CPU version first."
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
  if (support === null)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Checking WebGPU…
      </p>
    );
  // "model_missing" means WebGPU works; only the set is not installed yet.
  const available = support !== "unsupported";
  return (
    <StatusCheck ok={available}>
      {available ? "WebGPU available" : "WebGPU unavailable on this device"}
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
  if (!asset)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Unavailable in this build.
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
            <StatusCheck ok>Downloaded</StatusCheck>
          ) : downloading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {progress === 1
                ? "Verifying download…"
                : `Downloading ${Math.round((progress ?? 0) * 100)}%`}
            </p>
          ) : (
            <StatusCheck ok={false}>Not downloaded</StatusCheck>
          )}
        </div>
        {downloading ? (
          // Cancelling stays reachable while other changes are blocked.
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : installed ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || lowSpace}
            onClick={onInstall}
          >
            {failed ? "Retry download" : "Download"}
          </Button>
        )}
      </div>
      {downloading ? (
        <progress
          className="w-full"
          max={1}
          value={progress}
          aria-label={`${label} download progress`}
        />
      ) : null}
      {asset.status === "failed" ? (
        <p role="status" className="text-muted-foreground text-xs">
          {assetFailureText(asset)}
        </p>
      ) : null}
      {lowSpace ? (
        <p role="status" className="text-muted-foreground text-xs">
          Not enough free space: downloads need{" "}
          {formatFileSize(asset.required_free_bytes)} free.
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
