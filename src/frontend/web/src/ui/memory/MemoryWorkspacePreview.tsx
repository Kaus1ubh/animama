import {
  AlertTriangle,
  Copy,
  FileText,
  Loader2,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import { isEpisodeLogEntry } from "@/lib/memory-entries/protection";
import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

/** Renders caller-provided draft or persisted Markdown in the shared preview. */
export function MemoryWorkspacePreview({
  entry,
  displayPath,
  value,
  description,
  isLoading,
  isError,
  hasUnsavedDraft,
  unsavedLabel,
  onOpenVersions,
}: {
  entry: PyMemoryEntryResponse | null;
  /** Owner-facing path, such as an identity's `Animas/<name>/IDENTITY.md`. */
  displayPath?: string;
  value: string;
  description: string;
  isLoading: boolean;
  isError: boolean;
  hasUnsavedDraft: boolean;
  /** Badge for an unsaved draft; defaults to "Unsaved draft". */
  unsavedLabel?: string;
  onOpenVersions: () => void;
}) {
  const { t } = useTranslation("memory");
  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t("preview.loading")}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-destructive flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
        <AlertTriangle className="size-7" />
        {t("shared.fileLoadFailed")}
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <FileText className="size-8" />
        <p className="text-sm">{t("preview.selectFile")}</p>
      </div>
    );
  }

  const generated = isEpisodeLogEntry(entry);
  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("preview.copied"));
    } catch {
      toast.error(t("preview.copyFailed"));
    }
  };

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-border/40 min-w-0 shrink-0 border-b px-4 py-3">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h3
              className="text-foreground truncate text-sm font-semibold"
              title={displayPath ?? entry.path}
            >
              {displayPath ?? entry.path}
            </h3>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {description || t("shared.noDescription")}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => void copyPreview()}
              aria-label={t("preview.copyLabel")}
              title={t("preview.copyTitle")}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-muted-foreground font-mono text-xs"
              onClick={onOpenVersions}
            >
              {t("shared.version", { version: entry.version })}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {generated ? (
            <span className="bg-info/10 text-2xs text-info inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium">
              <Sparkles className="size-3" /> {t("preview.generated")}
            </span>
          ) : null}
          {generated ? (
            <span className="bg-muted text-muted-foreground text-2xs inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium">
              <LockKeyhole className="size-3" /> {t("preview.readOnly")}
            </span>
          ) : null}
          {hasUnsavedDraft ? (
            <span className="bg-warning/10 text-2xs text-warning rounded-sm px-2 py-1 font-medium">
              {unsavedLabel ?? t("preview.unsavedDraft")}
            </span>
          ) : null}
        </div>
      </div>
      <MemoryMarkdownPreview
        value={value}
        className="min-h-0 flex-1 overflow-auto p-5 lg:p-6"
      />
    </div>
  );
}
