import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getLastClientParakeetBackendState,
  getParakeetWebgpuStatus,
} from "@/lib/speech/client-parakeet/client";
import { isParakeetWebgpuPreferred } from "@/lib/settings/preferences";
import type { ParakeetWebgpuStatus } from "@/lib/speech/client-parakeet/webgpu";
import { Switch } from "@/ui/components/switch";
import { useSettings } from "@/ui/settings/SettingsProvider";

const WEBGPU_STATUS_TEXT: Record<ParakeetWebgpuStatus, string> = {
  available:
    "Available on this device. Applies the next time dictation or Voice Mode starts.",
  unsupported: "WebGPU is not available in this browser or on this device.",
  model_missing:
    "The GPU speech model is not installed. Developers: run python3 scripts/models/parakeet_webgpu.py acquire, then reset the stack.",
  unavailable_in_build: "Not available in this build yet.",
};

/** Opt-in features that may not work on every device. */
export function ExperimentalSettingsPanel({ disabled }: { disabled: boolean }) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const savedWebgpu = isParakeetWebgpuPreferred(userPreferences);
  const [webgpuEnabled, setWebgpuEnabled] = useState(savedWebgpu);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<ParakeetWebgpuStatus | null>(null);

  useEffect(() => setWebgpuEnabled(savedWebgpu), [savedWebgpu]);

  useEffect(() => {
    let cancelled = false;
    void getParakeetWebgpuStatus({ refresh: true }).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWebgpuChange = useCallback(
    (nextEnabled: boolean) => {
      if (isSaving) return;
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
    [isSaving, updateUserPreferences, webgpuEnabled],
  );

  const lastBackend = getLastClientParakeetBackendState();
  const statusText =
    lastBackend?.fellBackFromWebgpu && webgpuEnabled
      ? "WebGPU failed to load in the last session, so offline speech used the CPU."
      : lastBackend?.backend === "webgpu" && webgpuEnabled
        ? "Active: offline speech is running on WebGPU with live previews."
        : status
          ? WEBGPU_STATUS_TEXT[status]
          : "Checking WebGPU support…";

  return (
    <section className="border-border/60 bg-muted/10 flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <h3 className="text-foreground text-base font-semibold">
          Offline speech
        </h3>
        <p className="text-muted-foreground mt-2 text-xs">
          Experimental features may not work on every device.
        </p>
      </div>
      <div className="border-border/70 bg-background/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">
            GPU-accelerated offline speech (WebGPU)
          </p>
          <p className="text-muted-foreground text-xs">
            Runs offline speech recognition on the GPU and shows live
            transcripts while you speak. Falls back to the CPU if WebGPU is
            unavailable.
          </p>
          <p
            className="text-muted-foreground mt-1 text-xs"
            data-testid="parakeet-webgpu-status"
          >
            {statusText}
          </p>
        </div>
        <Switch
          checked={webgpuEnabled}
          onCheckedChange={handleWebgpuChange}
          disabled={disabled || isSaving}
          aria-label="Enable GPU-accelerated offline speech"
        />
      </div>
    </section>
  );
}
