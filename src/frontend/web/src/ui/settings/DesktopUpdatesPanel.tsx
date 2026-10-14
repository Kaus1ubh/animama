import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";

import type { UpdateStatus } from "../../../../shared/desktop-runtime";
import { useDesktopUpdates } from "@/hooks/useDesktopUpdates";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

/** Advice for an update failure code; unknown codes get the general advice. */
function failureAdvice(t: TFunction<"settings">, code: string): string {
  switch (code) {
    case "update_insufficient_disk":
      return t("updates.failures.update_insufficient_disk");
    case "update_pack_references_blocked":
      return t("updates.failures.update_pack_references_blocked");
    case "update_pack_operation_active":
      return t("updates.failures.update_pack_operation_active");
    case "pack_in_use":
      return t("updates.failures.pack_in_use");
    case "update_changed_check_again":
      return t("updates.failures.update_changed_check_again");
    case "update_install_timeout":
      return t("updates.failures.update_install_timeout");
    default:
      return t("updates.failures.generic");
  }
}

/** The status line for the updater state. */
function statusText(t: TFunction<"settings">, status: UpdateStatus): string {
  switch (status.state) {
    case "up_to_date":
      return t("updates.status.up_to_date");
    case "checking":
      return t("updates.status.checking");
    case "downloading":
      return t("updates.status.downloading");
    case "downloaded":
      return t("updates.status.downloaded");
    case "restarting":
      return t("updates.status.restarting");
    case "available":
      return t("updates.status.available");
    case "error":
      return failureAdvice(t, status.code);
    case "idle":
    case "unavailable":
      return t("updates.status.idle");
  }
}

/** Both the startup notice and Settings use the same explicit download/restart controls. */
export function DesktopUpdatesPanel({
  notice = false,
  className,
}: {
  notice?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("settings");
  const format = useFormatters();
  const { status, pending, error, run } = useDesktopUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const version = "version" in status ? status.version : undefined;
  const noticeKey = `${status.state}:${version ?? ""}`;
  if (
    status.state === "unavailable" ||
    (notice &&
      (![
        "available",
        "downloading",
        "downloaded",
        "restarting",
        "error",
      ].includes(status.state) ||
        dismissed === noticeKey ||
        (status.state === "error" && status.retry === "check")))
  )
    return null;
  const busy =
    pending || ["checking", "downloading", "restarting"].includes(status.state);
  const retry =
    status.state === "error"
      ? status.code === "update_changed_check_again"
        ? "check"
        : status.retry
      : null;
  const downloadable = status.state === "available" || retry === "download";
  const restartable = status.state === "downloaded" || retry === "restart";
  return (
    <section
      aria-label={t("updates.title")}
      className={cn(
        notice
          ? "border-border bg-background fixed right-4 bottom-4 z-50 w-[min(26rem,calc(100vw-2rem))] space-y-3 rounded-xl border p-5 shadow-lg"
          : "border-border/60 bg-muted/10 space-y-3 rounded-xl border p-5",
        className,
      )}
    >
      <h3 className="text-base font-semibold">
        {version ? t("updates.versionTitle", { version }) : t("updates.title")}
      </h3>
      <p className="text-muted-foreground text-sm" role="status">
        {statusText(t, status)}
      </p>
      {"downloadBytes" in status ? (
        <p className="text-muted-foreground text-xs">
          {t("updates.sizes", {
            download: format.number(status.downloadBytes),
            free: format.number(status.minimumFreeBytes),
          })}
        </p>
      ) : null}
      {status.state === "downloading" ? (
        <progress
          className="w-full"
          aria-label={t("updates.progress")}
          max={1}
          value={status.progress}
        />
      ) : null}
      {confirmRestart ? (
        <p className="text-sm">{t("updates.restartWarning")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!restartable && !downloadable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("check")}
          >
            {t("updates.actions.check")}
          </Button>
        ) : null}
        {downloadable ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void run("download")}
          >
            {retry
              ? t("updates.actions.retryDownload")
              : t("updates.actions.download")}
          </Button>
        ) : null}
        {restartable ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!confirmRestart) setConfirmRestart(true);
              else {
                setConfirmRestart(false);
                void run("restart");
              }
            }}
          >
            {confirmRestart
              ? t("updates.actions.confirmRestart")
              : t("updates.actions.restart")}
          </Button>
        ) : null}
        {notice && status.state !== "restarting" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDismissed(noticeKey);
              setConfirmRestart(false);
            }}
          >
            {t("updates.actions.later")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {t("updates.controlsUnavailable")}
        </p>
      ) : null}
    </section>
  );
}
