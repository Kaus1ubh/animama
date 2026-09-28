import { useRef, useState, type FormEvent } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";

import {
  prepareVoiceClone,
  type PreparedVoiceClone,
} from "@/lib/speech/pocket/voice-clones";
import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { useVoiceCloneActions } from "@/query/mutations/useVoiceCloneActions";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
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
  clones,
  selectedId,
  disabled,
  onSelect,
  onBusyChange,
}: {
  clones: PyVoiceContent[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
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
  const [editing, setEditing] = useState<PyVoiceContent | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<PyVoiceContent | null>(null);
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
    if (locked || pending.current || !file || !name.trim()) return;
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

  const saveRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !rename.trim() || locked || pending.current) return;
    changeBusy(true);
    setDialogError(null);
    try {
      await actions.renameVoiceClone.mutateAsync({
        clone: editing,
        name: rename.trim(),
      });
      setEditing(null);
      toast.success("Voice renamed.");
    } catch (cause) {
      setDialogError(
        cloneError(cause, "Voice could not be renamed. Try again."),
      );
    } finally {
      changeBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting || locked || pending.current) return;
    changeBusy(true);
    setDialogError(null);
    try {
      await actions.deleteVoiceClone.mutateAsync(deleting);
      setDeleting(null);
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
      <div>
        <h3 id="voice-cloning-heading" className="text-sm font-semibold">
          Voice Cloning
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Saved locally and available to all your Animas. Original samples are
          retained.
        </p>
      </div>
      {clones.length ? (
        <ul className="space-y-1" aria-label="Saved voice clones">
          {clones.map((clone) => (
            <li key={clone.item_id} className="flex items-center gap-2 py-1">
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={clone.name}
              >
                {clone.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked || selectedId === clone.item_id}
                aria-label={`Use ${clone.name}`}
                onClick={() =>
                  void onSelect(`clone:${clone.item_id}`).catch(() => undefined)
                }
              >
                {selectedId === clone.item_id ? "Selected" : "Use"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={locked}
                    aria-label={`Manage ${clone.name}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(clone);
                      setRename(clone.name);
                      setDialogError(null);
                    }}
                  >
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setDeleting(clone);
                      setDialogError(null);
                    }}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="space-y-2" onSubmit={(event) => void save(event)}>
        <label htmlFor="voice-clone-name" className="text-xs font-medium">
          New voice name
        </label>
        <Input
          id="voice-clone-name"
          value={name}
          placeholder="e.g. Storyteller"
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
            disabled={locked || !file || !name.trim()}
          >
            Save voice
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
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename voice</DialogTitle>
            <DialogDescription>
              This name appears for all your Animas.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => void saveRename(event)}
            className="space-y-4"
          >
            <Input
              aria-label="Voice clone name"
              value={rename}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setRename(event.target.value)}
            />
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
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || !rename.trim() || rename.trim() === editing?.name
                }
              >
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
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
              onClick={() => setDeleting(null)}
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
