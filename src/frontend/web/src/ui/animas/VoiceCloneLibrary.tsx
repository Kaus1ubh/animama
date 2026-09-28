import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type {
  PyModelAssetState,
  PyVoiceContent,
} from "@animama/runtime-contracts/api-types";

import {
  prepareVoiceClone,
  voiceCloneNameFromFile,
  type PreparedVoiceClone,
} from "@/lib/speech/pocket/voice-clones";
import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { useVoiceCloneActions } from "@/query/mutations/useVoiceCloneActions";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import {
  PocketVoiceEncoderDownloadRequired,
  POCKET_VOICE_ENCODER_ASSET_ID,
} from "@/lib/speech/pocket/voice-cloning-encoder";
import { VoiceCloningDownload } from "./VoiceCloningDownload";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

function cloneError(error: unknown, fallback: string): string {
  const code = parseContentApiErrorDetail(error)?.code;
  if (code === "catalog_item_in_use")
    return "This voice is used by an Anima. Choose another voice for each Anima using it before deleting.";
  if (code === "catalog_revision_conflict")
    return "This voice changed. Refresh the voice library and try again.";
  return error instanceof Error ? error.message : fallback;
}

/** Named originals and encoded voices are saved together, independently of selection. */
export function VoiceCloneLibrary({
  disabled,
  deleting,
  onDeleteClose,
  onBusyChange,
}: {
  disabled: boolean;
  deleting: PyVoiceContent | null;
  onDeleteClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const actions = useVoiceCloneActions();
  const modelAction = useModelAssetAction();
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<PreparedVoiceClone | null>(null);
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encoderOpen, setEncoderOpen] = useState(false);
  const [encoder, setEncoder] = useState<PyModelAssetState | null>(null);
  const [encoderError, setEncoderError] = useState<string | null>(null);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const reportBusy = useRef(onBusyChange);
  useEffect(() => {
    reportBusy.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(
    () => () => {
      if (operation.current) {
        operation.current.abort();
        reportBusy.current(false);
      }
    },
    [],
  );
  const locked = disabled || busy;
  const changeBusy = (value: boolean) => {
    pending.current = value;
    setBusy(value);
    onBusyChange(value);
  };

  const save = async (download = false) => {
    if (locked || pending.current || !file) return;
    const controller = new AbortController();
    operation.current = controller;
    let waitingForEncoder = download;
    changeBusy(true);
    setError(null);
    setEncoderError(null);
    try {
      if (!prepared.current) {
        if (download) {
          // Existing mutation updates the shared query before the local waiter
          // joins, so other open setup/settings views see this installation.
          const asset = await modelAction.mutateAsync({
            action: "install",
            assetId: POCKET_VOICE_ENCODER_ASSET_ID,
          });
          controller.signal.throwIfAborted();
          setEncoder(asset);
        }
        setStatus("Checking voice cloning…");
        const next = await prepareVoiceClone({
          name: name.trim(),
          file,
          encoder: {
            signal: controller.signal,
            onState: (asset) => {
              waitingForEncoder = asset.status !== "installed";
              setEncoder(asset);
              if (asset.status === "downloading") {
                setEncoderOpen(true);
                setStatus("Downloading voice cloning…");
              } else if (asset.status === "installed") {
                setEncoderOpen(false);
                setStatus("Cloning voice…");
              }
            },
          },
        });
        controller.signal.throwIfAborted();
        prepared.current = next;
      }
      controller.signal.throwIfAborted();
      setStatus("Saving voice…");
      await actions.saveVoiceClone.mutateAsync(prepared.current);
      controller.signal.throwIfAborted();
      prepared.current = null;
      setName("");
      setFile(null);
      toast.success("Voice clone saved. Choose it to use it for this Anima.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof PocketVoiceEncoderDownloadRequired) {
        setEncoder(cause.asset);
        if (cause.asset.status === "failed") setEncoderError(cause.message);
        setEncoderOpen(true);
      } else {
        const message = cloneError(
          cause,
          "Voice could not be saved. Your sample is ready to retry.",
        );
        if (waitingForEncoder) {
          setEncoderError(message);
          setEncoderOpen(true);
        } else setError(message);
      }
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setStatus(null);
        changeBusy(false);
      }
    }
  };

  const closeEncoder = () => {
    operation.current?.abort();
    operation.current = null;
    setEncoderOpen(false);
    setCancellingDownload(false);
    setStatus(null);
    changeBusy(false);
  };

  const cancelDownload = async () => {
    // Stop this operation before awaiting removal, so a download that finishes
    // during cancellation cannot continue into encoding or saving the sample.
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    changeBusy(true);
    setCancellingDownload(true);
    try {
      // This explicit action is global; closing or unmounting never removes bytes.
      const asset = await modelAction.mutateAsync({
        action: "remove",
        assetId: POCKET_VOICE_ENCODER_ASSET_ID,
      });
      controller.signal.throwIfAborted();
      setEncoder(asset);
      setEncoderError("Download cancelled. Your sample is ready to retry.");
      setStatus(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setEncoderError(
        cloneError(cause, "The download could not be cancelled. Try again."),
      );
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setCancellingDownload(false);
        changeBusy(false);
      }
    }
  };

  const remove = async () => {
    if (!deleting || locked || pending.current) return;
    changeBusy(true);
    setDialogError(null);
    try {
      await actions.deleteVoiceClone.mutateAsync(deleting);
      onDeleteClose();
      toast.success("Voice clone deleted.");
    } catch (cause) {
      setDialogError(
        cloneError(cause, "Voice could not be deleted. Try again."),
      );
    } finally {
      changeBusy(false);
    }
  };

  return (
    <section className="space-y-3 pt-3" aria-labelledby="voice-cloning-heading">
      <h3 id="voice-cloning-heading" className="text-sm font-semibold">
        Voice Cloning
      </h3>
      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          id="voice-clone-name"
          aria-label="Voice clone name"
          value={name}
          placeholder="Voice name (optional)"
          maxLength={120}
          disabled={locked}
          onChange={(event) => {
            setName(event.target.value);
            prepared.current = null;
            setError(null);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => input.current?.click()}
          >
            {file ? "Change sample" : "Upload voice sample"}
          </Button>
          <span
            className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
            title={file?.name}
          >
            {file?.name}
          </span>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={locked || !file}
          >
            Clone voice
          </Button>
          <input
            ref={input}
            type="file"
            accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
            className="hidden"
            aria-label="Upload custom voice sample"
            onChange={(event) => {
              const next = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (next) {
                setFile(next);
                if (!name.trim()) setName(voiceCloneNameFromFile(next.name));
                prepared.current = null;
                setError(null);
              }
            }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          WAV, MP3 or Ogg · up to 25 MiB. Use a clear recording of one speaker;
          cloning uses the first 10 seconds.
        </p>
        {status ? (
          <p role="status" className="text-muted-foreground text-xs">
            {status}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </form>
      <Dialog
        open={encoderOpen}
        onOpenChange={(open) => {
          if (!open) closeEncoder();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download voice cloning?</DialogTitle>
            <DialogDescription>
              Install voice cloning, then continue with your selected sample.
            </DialogDescription>
          </DialogHeader>
          {encoder ? (
            <VoiceCloningDownload
              asset={encoder}
              sampleName={file?.name ?? "Voice sample"}
              error={encoderError}
              busy={busy}
              cancelling={cancellingDownload}
              onDownload={() => void save(true)}
              onCancelDownload={() => void cancelDownload()}
              onClose={closeEncoder}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialogError(null);
            onDeleteClose();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              This removes the saved clone and its original sample. Voices used
              by an Anima must be replaced before deletion.
            </DialogDescription>
          </DialogHeader>
          {dialogError ? (
            <p role="alert" className="text-destructive text-sm">
              {dialogError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDialogError(null);
                onDeleteClose();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete voice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
