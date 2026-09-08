import { LoaderCircleIcon, UploadIcon } from "lucide-react";

import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Textarea } from "@/ui/components/textarea";

/** Standard paste-and-import dialog for portable creator JSON documents. */
export function CreatorImportDialog({
  open,
  onOpenChange,
  title,
  description,
  text,
  error,
  busy = false,
  ariaLabel = "Creator JSON",
  importLabel = "Import document",
  onTextChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  text: string;
  error: string | null;
  busy?: boolean;
  ariaLabel?: string;
  importLabel?: string;
  onTextChange: (text: string) => void;
  onImport: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(760px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-[min(56vh,520px)] font-mono text-xs"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          spellCheck={false}
          aria-label={ariaLabel}
        />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onImport} disabled={busy}>
            {busy ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <UploadIcon />
            )}
            {importLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
