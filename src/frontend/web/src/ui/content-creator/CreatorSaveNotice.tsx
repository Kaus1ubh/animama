import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LoaderCircleIcon,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import { getI18n, useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

type CreatorSaveNoticeProps = {
  message: ReactNode;
  tone?: "neutral" | "warning" | "error" | "success";
  busy?: boolean;
  actions?: ReactNode;
  className?: string;
  noticeRef?: Ref<HTMLElement>;
  focusOnError?: boolean;
};

/** Accessible save, recovery, and validation status surface. */
export function CreatorSaveNotice({
  message,
  tone = "neutral",
  busy = false,
  actions,
  className,
  noticeRef,
  focusOnError = false,
}: CreatorSaveNoticeProps) {
  const isError = tone === "error";
  const Icon = busy
    ? LoaderCircleIcon
    : tone === "success"
      ? CheckCircle2Icon
      : AlertTriangleIcon;
  return (
    <section
      ref={noticeRef}
      className={cn(
        "border-border bg-background flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2 text-xs shadow-lg",
        className,
      )}
      role={isError ? "alert" : "status"}
      aria-live="polite"
      aria-atomic="true"
      tabIndex={focusOnError && isError ? -1 : undefined}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          busy && "animate-spin motion-reduce:animate-none",
          isError && "text-destructive",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "neutral" && "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">{message}</span>
      {actions}
    </section>
  );
}

/**
 * Where the Avatar and Scene Effect creators show their save notice: under
 * the header on narrow layouts; on desktop, centred on the stage between the
 * panels, just above the canvas controls.
 */
export const CREATOR_STAGE_NOTICE_CLASS =
  "absolute top-[calc(var(--creator-header-height)+0.5rem)] right-4 left-4 z-[60] sm:left-auto sm:max-w-md lg:top-auto lg:right-[calc(var(--creator-inset)+min(var(--creator-right-panel-width),27vw)+0.75rem)] lg:bottom-[calc(var(--creator-canvas-controls-height)+2.75rem)] lg:left-[calc(var(--app-shell-sidebar-inset)+var(--creator-inset)+min(var(--creator-left-panel-width),26vw)+0.75rem)] lg:mx-auto";

/**
 * The notice every creator shows after restoring an unsaved browser draft,
 * worded in the active UI Locale when it is called (during render).
 */
export function creatorRecoveredMessage(contentLabel: string): string {
  const t = getI18n().getFixedT(null, "creator");
  return t("recovery.recovered", { label: contentLabel });
}

/**
 * Discard a restored draft: a new document returns to blank and a saved one
 * to its saved version (each creator supplies `onDiscard`).
 */
export function CreatorDiscardRecoveryButton({
  disabled = false,
  onDiscard,
}: {
  disabled?: boolean;
  onDiscard: () => void;
}) {
  const { t } = useTranslation("creator");
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={onDiscard}
    >
      {t("recovery.discard")}
    </Button>
  );
}

/**
 * The Avatar and Scene Effect creators' save notice: a Save error (with a way
 * to drop the preserved server draft), a recovery warning, or a restored
 * draft with Discard recovery, in that order.
 */
export function CreatorRecoveryNotice({
  error,
  recoveryWarning,
  recovered,
  busy,
  contentLabel,
  onDiscardServerDraft,
  onDiscardRecovery,
  className,
}: {
  error: string | null;
  recoveryWarning: string | null;
  /** A restored draft the user has not yet saved or discarded. */
  recovered: boolean;
  busy: boolean;
  contentLabel: string;
  onDiscardServerDraft: () => void;
  onDiscardRecovery: () => void;
  className?: string;
}) {
  const { t } = useTranslation("creator");
  if (!error && !recoveryWarning && !recovered) return null;
  return (
    <CreatorSaveNotice
      className={className}
      message={
        error ?? recoveryWarning ?? creatorRecoveredMessage(contentLabel)
      }
      tone={error ? "error" : "warning"}
      actions={
        error ? (
          <Button size="sm" variant="outline" onClick={onDiscardServerDraft}>
            {t("recovery.discardServerDraft")}
          </Button>
        ) : recovered ? (
          <CreatorDiscardRecoveryButton
            disabled={busy}
            onDiscard={onDiscardRecovery}
          />
        ) : null
      }
    />
  );
}
