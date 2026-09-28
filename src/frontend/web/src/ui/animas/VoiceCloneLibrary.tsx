import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";

import {
  prepareVoiceClone,
  voiceCloneNameFromFile,
  type PreparedVoiceClone,
} from "@/lib/speech/pocket/voice-clones";
import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { useVoiceCloneActions } from "@/query/mutations/useVoiceCloneActions";
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
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<PreparedVoiceClone | null>(null);
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy;
  const changeBusy = (value: boolean) => {
    pending.current = value;
    setBusy(value);
    onBusyChange(value);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (locked || pending.current || !file) return;
    changeBusy(true);
    setError(null);
    try {
      if (!prepared.current) {
        setStatus("Cloning voice…");
        prepared.current = await prepareVoiceClone({ name: name.trim(), file });
      }
      setStatus("Saving voice…");
      await actions.saveVoiceClone.mutateAsync(prepared.current);
      prepared.current = null;
      setName("");
      setFile(null);
      toast.success("Voice clone saved. Choose it to use it for this Anima.");
    } catch (cause) {
      setError(
        cloneError(
          cause,
          "Voice could not be saved. Your sample is ready to retry.",
        ),
      );
    } finally {
      setStatus(null);
      changeBusy(false);
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
      <form className="space-y-2" onSubmit={(event) => void save(event)}>
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
