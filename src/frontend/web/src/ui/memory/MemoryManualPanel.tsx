"use client";

import {
  Bot,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import type { MemoryEntryDraft } from "@/lib/memory-entries/workspace-drafts";
import { isMemoryEntryDraftDirty } from "@/lib/memory-entries/workspace-drafts";
import {
  canDeleteMemoryEntry,
  canEditMemoryEntry,
  isEpisodeLogEntry,
} from "@/lib/memory-entries/protection";
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

const MemoryCodeEditor = lazy(() =>
  import("@/ui/memory/MemoryCodeEditor").then((module) => ({
    default: module.MemoryCodeEditor,
  })),
);

/** Renders the selected file's version-aware Manual editing controls. */
export function MemoryManualPanel({
  entry,
  draft,
  isLoading,
  isError,
  isSaving,
  isDeleting,
  onContentChange,
  onDescriptionChange,
  onSave,
  onUseLatest,
  onDiscard,
  onDelete,
  onOpenManager,
}: {
  entry: PyMemoryEntryResponse | null;
  draft: MemoryEntryDraft | null;
  isLoading: boolean;
  isError: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onContentChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: (forceLatestVersion: boolean) => void;
  onUseLatest: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onOpenManager: () => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading editor...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-destructive flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm">
        Failed to load this memory file.
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <FileText className="size-8" />
        <p className="text-sm">Select a memory file to edit it.</p>
      </div>
    );
  }
  if (!canEditMemoryEntry(entry) || !draft) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <FileText className="size-8" />
        <div>
          <p className="text-foreground text-sm font-medium">
            {isEpisodeLogEntry(entry)
              ? "Generated episode"
              : "Read-only memory"}
          </p>
          <p className="mt-1 max-w-sm text-xs">
            This file can be previewed but cannot be changed manually.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onOpenManager}>
          <Bot className="size-4" /> Open Memory Manager
        </Button>
      </div>
    );
  }

  const dirty = isMemoryEntryDraftDirty(draft);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/40 shrink-0 space-y-2 border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="memory-workspace-description">Description</Label>
          {dirty ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Unsaved
            </span>
          ) : null}
        </div>
        <Input
          id="memory-workspace-description"
          value={draft.description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Optional description"
        />
      </div>
      {draft.conflict ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          This file has a newer server version. Your draft is preserved.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading editor...
            </div>
          }
        >
          <MemoryCodeEditor value={draft.content} onChange={onContentChange} />
        </Suspense>
      </div>
      <div className="border-border/40 bg-card flex shrink-0 flex-wrap justify-end gap-2 border-t p-3">
        {draft.conflict ? (
          <>
            <Button type="button" variant="outline" onClick={onUseLatest}>
              <RefreshCw className="size-4" /> Use latest
            </Button>
            <Button
              type="button"
              onClick={() => onSave(true)}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save over latest
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => onSave(false)}
            disabled={!dirty || isSaving}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!dirty}
          onClick={() => setConfirmDiscard(true)}
        >
          <Undo2 className="size-4" /> Discard
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canDeleteMemoryEntry(entry) || isDeleting}
          onClick={onDelete}
        >
          {isDeleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete
        </Button>
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              Your unsaved changes to {entry.path} will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onDiscard();
                setConfirmDiscard(false);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
