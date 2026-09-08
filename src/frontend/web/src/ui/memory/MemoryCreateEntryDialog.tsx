"use client";

import { Loader2, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import {
  memoryFileStemFromPath,
  normalizeMemoryEntryName,
} from "@/lib/memory-entries/entry-names";
import { memoryEntryErrorMessage } from "@/lib/memory-entries/errors";
import { useCreateMemoryEntry } from "@/query/mutations/useCreateMemoryEntry";
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
import { Textarea } from "@/ui/components/textarea";

export type CreateMemoryEntryKind = "file" | "directory";

/** Creates a user memory file or directory inside the focused physical parent. */
export function MemoryCreateEntryDialog({
  open,
  kind,
  parentId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  kind: CreateMemoryEntryKind;
  parentId: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (entry: PyMemoryEntryResponse) => void;
}) {
  const createEntry = useCreateMemoryEntry();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setContent("");
  }, [open, kind]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entryName = normalizeMemoryEntryName(name, kind);
    if (!entryName) {
      toast.error("Enter a name.");
      return;
    }

    try {
      const entry = await createEntry.mutateAsync({
        body: {
          parent_id: parentId ?? undefined,
          type: kind,
          name: entryName,
          content:
            kind === "file"
              ? content || `# ${memoryFileStemFromPath(entryName)}`
              : undefined,
          kind: kind === "file" ? "user_memory" : undefined,
          description: description || undefined,
          metadata: {},
          expected_version: 0,
          create_parents: kind === "file",
        },
      });
      toast.success(
        kind === "file" ? "Markdown file created." : "Directory created.",
      );
      onCreated(entry);
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to create memory entry.", {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {kind === "file" ? "New markdown file" : "New directory"}
          </DialogTitle>
          <DialogDescription>
            Names use filesystem-safe characters and files are stored as
            markdown.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="memory-entry-name">
              {kind === "file" ? "Name or path" : "Name"}
            </Label>
            <Input
              id="memory-entry-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                kind === "file" ? "notes.md or projects/notes.md" : "notes"
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory-entry-description">Description</Label>
            <Input
              id="memory-entry-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </div>
          {kind === "file" ? (
            <div className="space-y-2">
              <Label htmlFor="memory-entry-content">Initial content</Label>
              <Textarea
                id="memory-entry-content"
                className="min-h-32 font-mono text-sm"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="# Notes"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createEntry.isPending}>
              {createEntry.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
