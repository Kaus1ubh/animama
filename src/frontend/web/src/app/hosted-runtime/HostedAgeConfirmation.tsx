import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useRuntimeAdmission } from "../runtime/RuntimeAdmissionProvider";
import {
  AgeConfirmationBoundary,
  AgeConfirmationDialog,
} from "../runtime/AgeConfirmation";

/**
 * Hosted admits an account that has not confirmed 18+ with the app inert behind
 * the shared dialog. Confirming relays the answer to the server and opens the
 * same page in place; declining sends nothing and offers sign-out.
 */
export function HostedAgeConfirmation({ children }: { children: ReactNode }) {
  const { t } = useTranslation("setup");
  const { admission, controller } = useRuntimeAdmission();
  const pending = admission.status === "ready" && admission.onboardingRequired;
  return (
    <AgeConfirmationBoundary
      pending={pending}
      dialog={
        <AgeConfirmationDialog
          notice={t("ageConfirmation.betaNotice")}
          confirm={controller.confirmAge}
          failure={() => t("ageConfirmation.errors.confirmFailed")}
          declinedAction={{
            label: t("ageConfirmation.signOut"),
            run: () => void controller.signOut(),
          }}
        />
      }
    >
      {children}
    </AgeConfirmationBoundary>
  );
}
