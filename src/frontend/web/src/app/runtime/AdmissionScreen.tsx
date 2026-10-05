import type { RuntimeAdmission } from "@animama/runtime-contracts";
import { useState } from "react";

const messages = {
  loading: ["Preparing Animama…", ""],
  "sign-in-required": [
    "Sign in to Animama",
    "Sign in to access your Animas, chats and Library.",
  ],
  ineligible: [
    "Account access is not available",
    "This account is not eligible for hosted Animama. Check your account access or contact the operator.",
  ],
  restricted: [
    "Account access is restricted",
    "Your account is paused or being updated. You can check account access and try again later.",
  ],
  recovery: [
    "Your account needs recovery",
    "Animama could not finish preparing your account. Try recovery to continue.",
  ],
  unavailable: [
    "Runtime unavailable",
    "Animama could not reach the runtime. Please try again.",
  ],
} as const;

/** Common admission states render without mounting any private feature. */
export function AdmissionScreen({
  admission,
  hosted,
  retry,
  signIn,
  openAccount,
  signOut,
}: {
  admission: Exclude<RuntimeAdmission, { status: "ready" }>;
  hosted: boolean;
  retry: () => void;
  signIn?: () => void;
  openAccount?: () => void;
  signOut?: () => void;
}) {
  const [accountError, setAccountError] = useState<string | null>(null);
  const [title, description] = messages[admission.status];
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section
        className="border-border bg-card max-w-md space-y-4 rounded-2xl border p-6 text-center shadow-sm"
        aria-live="polite"
      >
        <h1 className="text-lg font-semibold">
          {admission.status === "unavailable" && !hosted
            ? "Local runtime unavailable"
            : title}
        </h1>
        {admission.message || description ? (
          <p className="text-muted-foreground text-sm">
            {admission.message ?? description}
          </p>
        ) : null}
        {admission.status !== "loading" ? (
          <button
            type="button"
            onClick={
              admission.status === "sign-in-required" && signIn ? signIn : retry
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
          >
            {admission.status === "sign-in-required" && signIn
              ? "Sign in"
              : admission.status === "recovery"
                ? "Try recovery"
                : "Try again"}
          </button>
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
                        : "Account access is unavailable.",
                    );
                  }
                }}
              >
                Account
              </button>
            ) : null}
            {signOut ? (
              <button type="button" onClick={signOut}>
                Sign out
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
