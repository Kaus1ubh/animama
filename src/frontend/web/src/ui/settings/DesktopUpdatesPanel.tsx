import { useState } from "react";
import { useDesktopUpdates } from "@/hooks/useDesktopUpdates";
import { Button } from "@/ui/components/button";

const failureAdvice: Record<string, string> = {
  update_insufficient_disk:
    "Free more disk space, then retry. Your current app and data are unchanged.",
  update_pack_references_blocked:
    "This update cannot keep your referenced Expanded Included content. Install a compatible pack or remove those references before retrying.",
  update_pack_operation_active:
    "Wait for the feature pack change to finish, then retry.",
  pack_in_use:
    "Finish active document jobs and close content previews before retrying.",
  update_changed_check_again:
    "The release changed since you checked. Check again before downloading.",
  update_install_timeout:
    "The installer did not finish in time. Quit and reopen Animama; do not reset your data.",
};

/** Both the startup notice and Settings use the same explicit download/restart controls. */
export function DesktopUpdatesPanel({ notice = false }: { notice?: boolean }) {
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
      aria-label="Desktop updates"
      className={
        notice
          ? "border-border bg-background fixed right-4 bottom-4 z-50 w-[min(26rem,calc(100vw-2rem))] space-y-3 rounded-xl border p-5 shadow-lg"
          : "border-border/60 bg-muted/10 space-y-3 rounded-xl border p-5"
      }
    >
      <h3 className="text-base font-semibold">
        {version ? `Animama ${version}` : "Desktop updates"}
      </h3>
      <p className="text-muted-foreground text-sm" role="status">
        {status.state === "up_to_date"
          ? "You’re up to date."
          : status.state === "checking"
            ? "Checking for updates…"
            : status.state === "downloading"
              ? "Downloading the approved update…"
              : status.state === "downloaded"
                ? "Update downloaded. Restart when you’re ready."
                : status.state === "restarting"
                  ? "Finishing work and restarting Animama…"
                  : status.state === "available"
                    ? "An update is available. Nothing downloads until you approve."
                    : status.state === "error"
                      ? (failureAdvice[status.code] ??
                        "The update could not finish. Your current app and data are preserved. Check your connection and retry.")
                      : "Checks run after startup. Downloads and restarts always need your approval."}
      </p>
      {"downloadBytes" in status ? (
        <p className="text-muted-foreground text-xs">
          {status.downloadBytes.toLocaleString()} bytes download ·{" "}
          {status.minimumFreeBytes.toLocaleString()} bytes free space required
        </p>
      ) : null}
      {status.state === "downloading" ? (
        <progress
          className="w-full"
          aria-label="Update download"
          max={1}
          value={status.progress}
        />
      ) : null}
      {confirmRestart ? (
        <p className="text-sm">
          Save unfinished edits first. Restart closes companion windows and
          stops local services before installing.
        </p>
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
            Check for updates
          </Button>
        ) : null}
        {downloadable ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void run("download")}
          >
            {retry ? "Retry download" : "Download update"}
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
            {confirmRestart ? "Confirm restart" : "Restart to install"}
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
            Later
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Update controls are temporarily unavailable. Reopen Settings or
          restart Animama.
        </p>
      ) : null}
    </section>
  );
}
