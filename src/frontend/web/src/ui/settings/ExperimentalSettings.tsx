import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  FeaturePackId,
  FeaturePackStatus,
} from "../../../../shared/desktop-runtime";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import {
  getLastClientParakeetBackendState,
  getParakeetWebgpuStatus,
} from "@/lib/speech/client-parakeet/client";
import { isParakeetWebgpuPreferred } from "@/lib/settings/preferences";
import type { ParakeetWebgpuStatus } from "@/lib/speech/client-parakeet/webgpu";
import { formatFileSize } from "@/lib/user-files/uploads";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";

const WEBGPU_STATUS_TEXT: Record<ParakeetWebgpuStatus, string> = {
  available:
    "Available on this device. Applies the next time dictation or Voice Mode starts.",
  unsupported: "WebGPU is not available in this browser or on this device.",
  model_missing:
    "The GPU speech model is not installed. Operators: run python3 scripts/models/parakeet_webgpu.py acquire on the host, then rerun reset.sh.",
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
}: {
  status: ParakeetWebgpuStatus | null;
  gpuPack: FeaturePackStatus | undefined;
  basePack: FeaturePackStatus | undefined;
  pending: FeaturePackId | null;
  error?: string | null;
  prompted: boolean;
  run(operation: "install" | "remove" | "cancel", id: FeaturePackId): void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (!gpuPack || (!gpuPack.available && !gpuPack.hasInstalledFiles))
    return null;
  // A refused or interrupted removal reports `failed` while this version stays active.
  const installed =
    gpuPack.state === "installed" ||
    (!!gpuPack.activeVersion && gpuPack.activeVersion === gpuPack.version);
  // Removal and recovery stay reachable even if this device later loses WebGPU.
  if (!installed && !gpuPack.hasInstalledFiles && status !== "model_missing")
    return null;
  const busy = BUSY_STATES.has(gpuPack.state);
  const baseReady =
    basePack?.state === "installed" || !!basePack?.activeVersion;
  const blocked = pending !== null;
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
          Install offline speech recognition first in General → Optional feature
          packs.
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
            disabled={!baseReady || blocked}
            onClick={() => run("install", GPU_PACK)}
          >
            <Download aria-hidden className="size-4" />
            {gpuPack.state === "failed"
              ? "Retry download"
              : gpuPack.state === "update_available"
                ? "Install compatible version"
                : "Download GPU encoder"}
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
            {confirmRemove ? "Confirm removal" : "Remove GPU encoder"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Opt-in WebGPU backend for offline (Parakeet) speech. Experimental: it may
 * not work on every device and falls back to the CPU.
 */
export function ParakeetWebgpuSetting({ disabled }: { disabled: boolean }) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const featurePacks = useDesktopFeaturePacks();
  const gpuPack = featurePacks.available
    ? featurePacks.packs.find((pack) => pack.id === GPU_PACK)
    : undefined;
  const basePack = featurePacks.packs.find((pack) => pack.id === BASE_PACK);
  const downloadable = Boolean(gpuPack?.available);
  const desktop = useRuntimePlatform().kind === "desktop";
  const [prompted, setPrompted] = useState(false);
  const savedWebgpu = isParakeetWebgpuPreferred(userPreferences);
  const [webgpuEnabled, setWebgpuEnabled] = useState(savedWebgpu);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<ParakeetWebgpuStatus | null>(null);

  useEffect(() => setWebgpuEnabled(savedWebgpu), [savedWebgpu]);

  // Recheck when the encoder pack settles (pack changes also reload the app).
  const gpuPackState = gpuPack?.state;
  useEffect(() => {
    let cancelled = false;
    void getParakeetWebgpuStatus({ refresh: true }).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [gpuPackState]);

  const handleWebgpuChange = useCallback(
    (nextEnabled: boolean) => {
      if (isSaving) return;
      // Turning it on without the encoder points at the download instead of
      // silently falling back to the CPU.
      setPrompted(nextEnabled && status === "model_missing" && downloadable);
      const previous = webgpuEnabled;
      setWebgpuEnabled(nextEnabled);
      setIsSaving(true);
      void updateUserPreferences({
        speech: { stt_parakeet_webgpu: nextEnabled },
      })
        .catch(() => {
          setWebgpuEnabled(previous);
          toast.error("Failed to update the WebGPU speech setting.");
        })
        .finally(() => setIsSaving(false));
    },
    [downloadable, isSaving, status, updateUserPreferences, webgpuEnabled],
  );

  const lastBackend = getLastClientParakeetBackendState();
  const statusText =
    lastBackend?.fellBackFromWebgpu && webgpuEnabled
      ? "WebGPU failed to load in the last session, so offline speech used the CPU."
      : lastBackend?.backend === "webgpu" && webgpuEnabled
        ? "Active: offline speech is running on WebGPU with live previews."
        : status === "model_missing" && downloadable
          ? "The GPU speech encoder is not installed. Download it below; your offline speech keeps using the CPU until then."
          : status === "model_missing" && desktop && featurePacks.available
            ? "The GPU speech encoder is not installed, and this app version does not include it."
            : status
              ? WEBGPU_STATUS_TEXT[status]
              : "Checking WebGPU support…";

  return (
    <SettingsRow
      label="GPU-accelerated offline speech (WebGPU)"
      description="Runs offline speech recognition on the GPU and shows live transcripts while you speak. Falls back to the CPU if WebGPU is unavailable."
      control={
        <Switch
          checked={webgpuEnabled}
          onCheckedChange={handleWebgpuChange}
          disabled={disabled || isSaving}
          aria-label="Enable GPU-accelerated offline speech"
        />
      }
    >
      <p
        className="text-muted-foreground text-xs"
        data-testid="parakeet-webgpu-status"
      >
        {statusText}
      </p>
      <ParakeetWebgpuDownload
        status={status}
        gpuPack={gpuPack}
        basePack={basePack}
        pending={featurePacks.pending}
        error={featurePacks.error}
        prompted={prompted}
        run={(operation, id) => void featurePacks.run(operation, id)}
      />
    </SettingsRow>
  );
}
