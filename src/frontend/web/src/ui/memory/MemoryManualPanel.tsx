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
import { useTranslation } from "react-i18next";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import type { MemoryEntryDraft } from "@/lib/memory-entries/workspace-drafts";
import { isMemoryEntryDraftDirty } from "@/lib/memory-entries/workspace-drafts";
import { isReservedUserMemoryEntry } from "@/lib/memory-entries/anima-folders";
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
  const { t } = useTranslation("memory");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" />{" "}
        {t("shared.loadingEditor")}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-destructive flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm">
        {t("shared.fileLoadFailed")}
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <FileText className="size-8" />
        <p className="text-sm">{t("manual.selectFile")}</p>
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
              ? t("manual.generatedEpisode")
              : isReservedUserMemoryEntry(entry)
                ? t("manual.reservedPath")
                : t("manual.readOnly")}
          </p>
          <p className="mt-1 max-w-sm text-xs">
            {isReservedUserMemoryEntry(entry)
              ? t("manual.reservedHint")
              : t("manual.readOnlyHint")}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onOpenManager}>
          <Bot className="size-4" /> {t("manual.openManager")}
        </Button>
      </div>
    );
  }

  const dirty = isMemoryEntryDraftDirty(draft);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/40 shrink-0 space-y-2 border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="memory-workspace-description">
            {t("shared.description")}
          </Label>
          {dirty ? (
            <span className="text-warning text-xs">{t("manual.unsaved")}</span>
          ) : null}
        </div>
        <Input
          id="memory-workspace-description"
          value={draft.description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={t("shared.optionalDescription")}
        />
      </div>
      {draft.conflict ? (
        <div className="border-warning/30 bg-warning/10 text-warning border-b px-4 py-3 text-sm">
          {t("shared.conflictNotice")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              <Loader2 className="mr-2 size-4 animate-spin" />{" "}
              {t("shared.loadingEditor")}
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
              <RefreshCw className="size-4" /> {t("shared.useLatest")}
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
              {t("manual.saveOverLatest")}
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
            {t("shared.save")}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!dirty}
          onClick={() => setConfirmDiscard(true)}
        >
          <Undo2 className="size-4" /> {t("shared.discard")}
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
          {t("shared.delete")}
        </Button>
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("manual.discard.title")}</DialogTitle>
            <DialogDescription>
              {t("manual.discard.description", { path: entry.path })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
              {t("shared.cancel")}
            </Button>
            <Button
              onClick={() => {
                onDiscard();
                setConfirmDiscard(false);
              }}
            >
              {t("shared.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
