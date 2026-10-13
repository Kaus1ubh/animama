import type { RuntimeAdmission } from "@animama/runtime-contracts";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type AdmissionStatus = Exclude<RuntimeAdmission, { status: "ready" }>["status"];

/** Heading and explanation for an admission state; loading has no explanation. */
function admissionCopy(
  t: TFunction<"app">,
  status: AdmissionStatus,
): [title: string, description: string | null] {
  switch (status) {
    case "loading":
      return [t("admission.loading.title"), null];
    case "sign-in-required":
      return [
        t("admission.signInRequired.title"),
        t("admission.signInRequired.description"),
      ];
    case "ineligible":
      return [
        t("admission.ineligible.title"),
        t("admission.ineligible.description"),
      ];
    case "restricted":
      return [
        t("admission.restricted.title"),
        t("admission.restricted.description"),
      ];
    case "recovery":
      return [
        t("admission.recovery.title"),
        t("admission.recovery.description"),
      ];
    case "unavailable":
      return [
        t("admission.unavailable.title"),
        t("admission.unavailable.description"),
      ];
  }
}

/** Common admission states render without mounting any private feature. */
export function AdmissionScreen({
  admission,
  hosted,
  signOutIncomplete = false,
  retry,
  signIn,
  openAccount,
  signOut,
}: {
  admission: Exclude<RuntimeAdmission, { status: "ready" }>;
  hosted: boolean;
  /** An explicit sign-out has not finished; `retry` repeats it. */
  signOutIncomplete?: boolean;
  retry: () => void;
  signIn?: () => void;
  openAccount?: () => void;
  signOut?: () => void;
}) {
  const { t } = useTranslation("app");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [title, description] = signOutIncomplete
    ? [
        t("admission.signOutIncomplete.title"),
        t("admission.signOutIncomplete.description"),
      ]
    : admissionCopy(t, admission.status);
  // A sign-in view keeps its explanation and announces a problem as an alert.
  const alert =
    admission.status === "sign-in-required" ? admission.message : undefined;
  const text = alert ? description : (admission.message ?? description);
  const offersSignIn =
    admission.status === "sign-in-required" &&
    !signOutIncomplete &&
    signIn !== undefined;
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section
        className="border-border bg-card max-w-md space-y-4 rounded-2xl border p-6 text-center shadow-sm"
        aria-live="polite"
      >
        <h1 className="text-lg font-semibold">
          {admission.status === "unavailable" && !hosted
            ? t("admission.unavailable.localTitle")
            : title}
        </h1>
        {text ? <p className="text-muted-foreground text-sm">{text}</p> : null}
        {alert ? (
          <p role="alert" className="text-sm font-medium">
            {alert}
          </p>
        ) : null}
        {admission.status !== "loading" ? (
          <button
            type="button"
            onClick={offersSignIn ? signIn : retry}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
          >
            {offersSignIn
              ? t("admission.actions.signIn")
              : admission.status === "recovery"
                ? t("admission.actions.tryRecovery")
                : t("admission.actions.tryAgain")}
          </button>
        ) : null}
        {signOutIncomplete && signIn ? (
          <div className="flex justify-center gap-4 text-sm">
            <button type="button" onClick={signIn}>
              {t("admission.actions.signIn")}
            </button>
          </div>
        ) : null}
        {hosted &&
        admission.status !== "loading" &&
        admission.status !== "sign-in-required" ? (
          <div className="flex justify-center gap-4 text-sm">
            {openAccount ? (
              <button
                type="button"
                onClick={() => {
                  try {
                    openAccount();
                  } catch (error) {
                    setAccountError(
                      error instanceof Error
                        ? error.message
                        : t("admission.accountUnavailable"),
                    );
                  }
                }}
              >
                {t("admission.actions.account")}
              </button>
            ) : null}
            {signOut ? (
              <button type="button" onClick={signOut}>
                {t("admission.actions.signOut")}
              </button>
            ) : null}
          </div>
        ) : null}
        {accountError ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {accountError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
