import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

/** Keeps the loaded app mounted, but inert, while the 18+ confirmation is pending. */
export function AgeConfirmationBoundary({
  pending,
  dialog,
  children,
}: {
  pending: boolean;
  dialog: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/* Keep this boundary stable so accepting never remounts the loaded app. */}
      <div className="contents" inert={pending}>
        {children}
      </div>
      {pending ? dialog : null}
    </>
  );
}

export type AgeConfirmationDialogProps = {
  /** Shown above the dialog's content, inside its layer (hosted's beta notice). */
  notice?: ReactNode;
  /** Sends the explicit answer. A rejection keeps the dialog open with `failure`. */
  confirm: () => Promise<void>;
  /** The alert for a failed confirmation, worded in the UI Locale. */
  failure: (cause: unknown) => string;
  /** False while the answer cannot be sent yet. */
  canConfirm?: boolean;
  /** What a person who declined can do; without it they can go back and answer again. */
  declinedAction?: { label: string; run: () => void };
  /** Runtime-specific controls below the safety link, given whether an answer is being sent. */
  children?: (state: { submitting: boolean }) => ReactNode;
};

/**
 * The 18+ confirmation every runtime shows. It has no close button, Escape or
 * outside click; only the explicit confirm button supplies the answer.
 */
export function AgeConfirmationDialog({
  notice,
  confirm,
  failure,
  canConfirm = true,
  declinedAction,
  children,
}: AgeConfirmationDialogProps) {
  const { t } = useTranslation("setup");
  const [declined, setDeclined] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The failure's cause, worded at render so the alert follows the UI Locale.
  const [failed, setFailed] = useState<{ cause: unknown } | null>(null);

  const send = async () => {
    if (submitting || !canConfirm) return;
    setSubmitting(true);
    setFailed(null);
    try {
      // Success replaces the admission, which closes this dialog.
      await confirm();
    } catch (cause) {
      setFailed({ cause });
    }
    // Still open after a reply (for example a stale read won): the answer can be sent again.
    setSubmitting(false);
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {notice ? (
          <p
            role="note"
            className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs"
          >
            {notice}
          </p>
        ) : null}
        <DialogHeader>
          <DialogTitle>{t("ageConfirmation.heading")}</DialogTitle>
          <DialogDescription>{t("ageConfirmation.notice")}</DialogDescription>
        </DialogHeader>
        <Link
          to="/safety"
          className="text-muted-foreground text-xs underline underline-offset-2"
        >
          {t("ageConfirmation.safetyLink")}
        </Link>
        {declined ? (
          <p role="status" className="text-sm">
            {t("ageConfirmation.declined")}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            {failure(failed.cause)}
          </p>
        ) : null}
        {children?.({ submitting })}
        <DialogFooter>
          {declined ? (
            declinedAction ? (
              <Button variant="outline" onClick={declinedAction.run}>
                {declinedAction.label}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setDeclined(false)}>
                {t("ageConfirmation.goBack")}
              </Button>
            )
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={() => setDeclined(true)}
              >
                {t("ageConfirmation.decline")}
              </Button>
              <Button
                disabled={submitting || !canConfirm}
                onClick={() => void send()}
              >
                {submitting
                  ? t("ageConfirmation.opening")
                  : t("ageConfirmation.confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
