import { useState } from "react";

import {
  type FeaturePackId,
  type FeaturePackStatus,
} from "../../../../shared/desktop-runtime";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

const names: Record<FeaturePackId, string> = {
  "parakeet-stt": "Offline speech recognition",
  "parakeet-stt-webgpu": "GPU speech encoder",
  "expanded-included-content": "Expanded Included content",
  "document-processing": "Document processing",
};
const descriptions: Record<FeaturePackId, string> = {
  "parakeet-stt":
    "Enables offline dictation and Voice Mode. Microphone permission and PocketTTS do not require this pack.",
  "parakeet-stt-webgpu":
    "Runs offline speech recognition on the GPU with live previews. Requires offline speech recognition and a WebGPU-capable device.",
  "expanded-included-content":
    "Adds selectable content to Included. It never changes your Anima’s loadout automatically.",
  "document-processing":
    "Extracts and indexes uploaded documents. Removing it preserves your originals and queued work.",
};

/** Exact byte counts come from the embedded release catalog, not estimates in UI code. */
export function packSizeSummary(pack: FeaturePackStatus): string {
  if (
    pack.downloadBytes === undefined ||
    pack.installedBytes === undefined ||
    pack.minimumFreeBytes === undefined
  )
    return "No compatible released pack is included in this app’s catalog.";
  const bytes = (value: number) => `${value.toLocaleString()} bytes`;
  return `${bytes(pack.downloadBytes)} download · ${bytes(pack.installedBytes)} installed · ${bytes(pack.minimumFreeBytes)} free space required`;
}

/** Reuse the same catalog/IPC controls in Settings and contextual install actions. */
export function DesktopFeaturePacksPanel({
  only,
  className,
}: {
  only?: FeaturePackId;
  className?: string;
}) {
  const { available, packs, pending, error, run } = useDesktopFeaturePacks();
  const [confirmRemove, setConfirmRemove] = useState<FeaturePackId | null>(
    null,
  );
  if (!available) return null;
  // General Settings follows the embedded catalog. Preserve retained files for
  // removal/recovery even if a later release no longer offers their pack.
  // Contextual controls may still explain why their required pack is unavailable.
  // The GPU encoder is offered only beside the WebGPU setting, which checks
  // for an adapter first; here it appears only for recovery or removal.
  const visiblePacks = packs.filter((pack) =>
    only
      ? pack.id === only
      : pack.hasInstalledFiles ||
        (pack.available && pack.id !== "parakeet-stt-webgpu"),
  );
  if (!visiblePacks.length && !error) return null;
  const changing = packs.some((pack) =>
    ["downloading", "verifying", "installing"].includes(pack.state),
  );
  return (
    <section
      className={cn(
        "border-border/60 bg-muted/10 space-y-4 rounded-xl border p-5",
        className,
      )}
      aria-label="Optional feature packs"
    >
      <h3 className="text-base font-semibold">
        {only ? names[only] : "Optional feature packs"}
      </h3>
      <p className="text-muted-foreground text-sm">
        Save unfinished edits first. Activating or removing a pack briefly
        reloads the app and closes companion windows.
      </p>
      {visiblePacks.map((pack) => {
        const { id } = pack;
        const busy = ["downloading", "verifying", "installing"].includes(
          pack.state,
        );
        return (
          <div key={id} className="space-y-2">
            {!only ? (
              <h4 className="text-sm font-medium">{names[id]}</h4>
            ) : null}
            <p className="text-muted-foreground text-sm">{descriptions[id]}</p>
            <p className="text-muted-foreground text-xs">
              {packSizeSummary(pack)}
            </p>
            <p className="text-sm" role="status">
              {pack.state.replaceAll("_", " ")}
              {pack.version ? ` · ${pack.version}` : ""}
              {pack.error ? ` · ${pack.error}` : ""}
            </p>
            {busy ? (
              <progress
                className="w-full"
                max={1}
                value={pack.progress ?? 0}
                aria-label={`${names[id]} progress`}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {pack.state !== "installed" &&
              // A refused removal reports `failed` while this version stays active.
              !(pack.activeVersion && pack.activeVersion === pack.version) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!pack.available || changing || pending !== null}
                  onClick={() => void run("install", id)}
                >
                  {pack.state === "update_available"
                    ? "Install compatible version"
                    : "Install"}
                </Button>
              ) : null}
              {busy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void run("cancel", id)}
                >
                  Cancel
                </Button>
              ) : null}
              {pack.hasInstalledFiles && !busy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={changing || pending !== null}
                  onClick={() => {
                    if (confirmRemove !== id) setConfirmRemove(id);
                    else {
                      setConfirmRemove(null);
                      void run("remove", id);
                    }
                  }}
                >
                  {confirmRemove === id ? "Confirm removal" : "Remove"}
                </Button>
              ) : null}
            </div>
            {pack.error === "pack_in_use" ? (
              <p className="text-muted-foreground text-sm">
                Finish active document jobs, close content previews, and remove
                this pack’s entries from Anima loadouts before retrying.
              </p>
            ) : null}
            {pack.error === "pack_cleanup_pending" ? (
              <p className="text-muted-foreground text-sm">
                The pack is no longer active, but some files remain. Close
                applications using those files, then retry Remove.
              </p>
            ) : null}
            {pack.blockers?.length ? (
              <ul className="text-muted-foreground list-inside list-disc text-sm">
                {pack.blockers.map((blocker) => (
                  <li key={`${blocker.kind}:${blocker.id}`}>{blocker.label}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
