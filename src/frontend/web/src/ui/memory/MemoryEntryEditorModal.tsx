import { Loader2, Save, Trash2 } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import {
  isMemoryEntryConflict,
  memoryEntryErrorMessage,
} from "@/lib/memory-entries/errors";
import {
  canDeleteMemoryEntry,
  canEditMemoryEntry,
  isBlankAnimaIdentityDraft,
} from "@/lib/memory-entries/protection";
import {
  useMemoryEntry,
  useMemoryEntryByPath,
} from "@/query/hooks/useMemoryEntries";
import { useDeleteMemoryEntry } from "@/query/mutations/useDeleteMemoryEntry";
import { usePatchMemoryEntry } from "@/query/mutations/usePatchMemoryEntry";
import {
  createMemoryEntryDraft,
  syncMemoryEntryDraft,
  updateMemoryEntryDraft,
  type MemoryEntryDraft,
} from "@/lib/memory-entries/workspace-drafts";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

const MemoryMarkdownEditor = lazy(() =>
  import("@/ui/memory/MemoryMarkdownEditor").then((module) => ({
    default: module.MemoryMarkdownEditor,
  })),
);

type MemoryEntryEditorModalProps = {
  entryId?: string | null;
  animaId?: string | null;
  path?: string | null;
  allowedScope?: "user" | "anima" | "any";
  onEntryChanged?: (entry: PyMemoryEntryResponse) => void;
  onClose: () => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
};

export function MemoryEntryEditorModal({
  entryId,
  animaId,
  path,
  allowedScope = "any",
  onEntryChanged,
  onClose,
  onCloseAutoFocus,
}: MemoryEntryEditorModalProps) {
  const { t } = useTranslation("memory");
  const hasSelection = Boolean(entryId || path);
  const byIdQuery = useMemoryEntry(entryId, {
    enabled: hasSelection && Boolean(entryId),
  });
  const byPathQuery = useMemoryEntryByPath({
    animaId,
    path,
    type: "file",
    enabled: hasSelection && !entryId && Boolean(path),
  });
  const patchEntry = usePatchMemoryEntry();
  const deleteEntry = useDeleteMemoryEntry();
  const rawEntry = byIdQuery.data ?? byPathQuery.data ?? null;
  const scopeMismatch =
    rawEntry !== null &&
    allowedScope !== "any" &&
    rawEntry.scope !== allowedScope;
  const entry = scopeMismatch ? null : rawEntry;
  const isLoading = byIdQuery.isLoading || byPathQuery.isLoading;
  const isError = byIdQuery.isError || byPathQuery.isError || scopeMismatch;
  const readOnly = entry ? !canEditMemoryEntry(entry) : false;
  const [draft, setDraft] = useState<MemoryEntryDraft | null>(null);
  const draftContent = draft?.content ?? "";
  const draftDescription = draft?.description ?? "";
  const conflict = draft?.conflict ?? false;
  const setDraftContent = (content: string) =>
    setDraft((current) =>
      current ? updateMemoryEntryDraft(current, { content }) : current,
    );
  const setDraftDescription = (description: string) =>
    setDraft((current) =>
      current ? updateMemoryEntryDraft(current, { description }) : current,
    );

  useEffect(() => {
    if (!entry) return;
    setDraft((current) =>
      current?.entryId === entry.id
        ? syncMemoryEntryDraft(current, entry)
        : createMemoryEntryDraft(entry),
    );
  }, [entry]);

  useEffect(() => {
    if (!hasSelection) {
      setDraft(null);
    }
  }, [hasSelection]);

  const refetchCurrent = async () => {
    if (entryId) {
      await byIdQuery.refetch();
    } else {
      await byPathQuery.refetch();
    }
  };

  const handleSave = async (forceLatestVersion = false) => {
    if (!entry || !draft) return;
    if (!canEditMemoryEntry(entry)) return;
    if (isBlankAnimaIdentityDraft(entry, draftContent)) {
      toast.error(t("shared.blankIdentity"));
      return;
    }

    try {
      const updated = await patchEntry.mutateAsync({
        entryId: entry.id,
        body: {
          expected_version: forceLatestVersion
            ? entry.version
            : draft.baseVersion,
          expected_aggregate_revision: forceLatestVersion
            ? entry.aggregate_revision
            : draft.baseAggregateRevision,
          content: draftContent,
          description: draftDescription,
        },
      });
      setDraft(createMemoryEntryDraft(updated));
      onEntryChanged?.(updated);
      toast.success(
        forceLatestVersion ? t("shared.draftSaved") : t("shared.memorySaved"),
      );
    } catch (error) {
      if (isMemoryEntryConflict(error)) {
        setDraft((current) =>
          current ? { ...current, conflict: true } : current,
        );
        await refetchCurrent();
        toast.error(t("shared.changedElsewhere"), {
          description: t("shared.draftStillOpen"),
        });
        return;
      }
      toast.error(t("shared.saveFailed"), {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  const handleDelete = async () => {
    if (!entry || !canDeleteMemoryEntry(entry)) return;
    try {
      await deleteEntry.mutateAsync({
        entryId: entry.id,
        expectedVersion: entry.version,
        recursive: false,
      });
      toast.success(t("editor.deleted"));
      onClose();
    } catch (error) {
      toast.error(t("editor.deleteFailed"), {
        description: memoryEntryErrorMessage(error),
      });
    }
  };

  const handleUseLatest = () => {
    if (!entry) return;
    setDraft(createMemoryEntryDraft(entry));
  };

  return (
    <Dialog open={hasSelection} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        avoidSidebar
        className="flex h-[min(86vh,58rem)] w-[min(96vw,90rem)] max-w-none flex-col gap-0 overflow-hidden p-0 max-sm:h-[100dvh] max-sm:w-full max-sm:rounded-none max-sm:ring-0 sm:max-w-none"
      >
        <div className="border-border/70 flex shrink-0 flex-col border-b p-4">
          <DialogHeader className="pr-10">
            <DialogTitle>
              {entry?.path ?? t("editor.fallbackTitle")}
            </DialogTitle>
          </DialogHeader>
          {entry ? (
            <div className="mt-3 max-w-3xl space-y-2">
              {readOnly ? (
                <>
                  <Label>{t("shared.description")}</Label>
                  <p className="text-muted-foreground text-sm">
                    {entry.description || t("shared.noDescription")}
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="memory-entry-editor-description">
                    {t("shared.description")}
                  </Label>
                  <Input
                    id="memory-entry-editor-description"
                    value={draftDescription}
                    onChange={(event) =>
                      setDraftDescription(event.target.value)
                    }
                    placeholder={t("shared.optionalDescription")}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t("editor.loadingFile")}
          </div>
        ) : isError || !entry ? (
          <div className="text-destructive flex flex-1 items-center justify-center text-sm">
            {t("shared.fileLoadFailed")}
          </div>
        ) : (
          <>
            {conflict && !readOnly ? (
              <div className="border-warning/30 bg-warning/10 text-warning border-b px-4 py-3 text-sm">
                {t("shared.conflictNotice")}
              </div>
            ) : null}
            {readOnly ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-border/70 bg-muted/20 text-muted-foreground border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
                  {t("shared.preview")}
                </div>
                <MemoryMarkdownPreview
                  value={draftContent}
                  className="min-h-0 flex-1 overflow-auto p-6"
                />
              </div>
            ) : (
              <>
                <Suspense
                  fallback={
                    <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("shared.loadingEditor")}
                    </div>
                  }
                >
                  <MemoryMarkdownEditor
                    value={draftContent}
                    onChange={setDraftContent}
                  />
                </Suspense>
                <div className="border-border/70 bg-card flex shrink-0 justify-end border-t p-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    {conflict ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleUseLatest}
                        >
                          {t("shared.useLatest")}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleSave(true)}
                          disabled={patchEntry.isPending}
                        >
                          {patchEntry.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Save className="size-4" />
                          )}
                          {t("editor.saveDraftOverLatest")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => void handleSave(false)}
                        disabled={patchEntry.isPending}
                      >
                        {patchEntry.isPending ? (
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
                      disabled={
                        !canDeleteMemoryEntry(entry) || deleteEntry.isPending
                      }
                      onClick={() => void handleDelete()}
                    >
                      {deleteEntry.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      {t("shared.delete")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
