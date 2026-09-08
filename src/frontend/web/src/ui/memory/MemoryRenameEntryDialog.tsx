"use client";

import { Loader2, Pencil } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import {
  memoryEntryNameSelectionEnd,
  normalizeMemoryEntryName,
} from "@/lib/memory-entries/entry-names";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";

/** Collects a name-only, revision-aware relocation request. */
export function MemoryRenameEntryDialog({
  entry,
  open,
  isRenaming,
  onOpenChange,
  onConfirm,
}: {
  entry: PyMemoryEntryHeader | null;
  open: boolean;
  isRenaming: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open && entry) setName(entry.name);
  }, [entry, open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!entry) return;
    const nextName = normalizeMemoryEntryName(name, entry.type);
    if (!nextName) {
      toast.error("Enter a name.");
      return;
    }
    if (nextName === entry.name) {
      onOpenChange(false);
      return;
    }
    if (await onConfirm(nextName)) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isRenaming) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Rename {entry?.type === "directory" ? "directory" : "file"}
          </DialogTitle>
          <DialogDescription className="truncate" title={entry?.path}>
            {entry?.path}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="memory-entry-rename">Name</Label>
            <Input
              id="memory-entry-rename"
              value={name}
              autoFocus
              onFocus={(event) => {
                if (!entry) return;
                event.currentTarget.setSelectionRange(
                  0,
                  memoryEntryNameSelectionEnd(entry.name, entry.type),
                );
              }}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isRenaming}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isRenaming}>
              {isRenaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Pencil className="size-4" />
              )}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
