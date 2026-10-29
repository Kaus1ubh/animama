import { Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import { useLocalRuntime } from "../LocalRuntimeProvider";
import { useRuntimeAdmission } from "../../runtime/RuntimeAdmissionProvider";
import {
  AgeConfirmationBoundary,
  AgeConfirmationDialog,
} from "../../runtime/AgeConfirmation";
import {
  clearSetupDraft,
  readSetupDraft,
  writeSetupDraft,
  type SetupDraft,
} from "../setup-draft";
import { normalizeLocalDisplayName } from "@/lib/user-profile/display-name";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import { ModelLink } from "@/ui/components/model-link";
import {
  modelConfigurationErrorCode,
  modelSettingsAvailability,
} from "@/ui/settings/models/model-configuration-state";

// The texts every installation agrees to, published on the public website.
const TERMS_URL = "https://animama.ai/terms/";
const PRIVACY_URL = "https://animama.ai/privacy/";

/** Load the app behind an inert boundary while explicit confirmation is pending. */
export function FirstRunAgeConfirmation({ children }: { children: ReactNode }) {
  const { admission } = useRuntimeAdmission();
  const { state } = useLocalRuntime();
  const pending = admission.status === "ready" && admission.onboardingRequired;
  const draft =
    pending && state.status === "ready"
      ? readSetupDraft(state.principalId)
      : null;
  if (pending) {
    if (!draft) return null;
    if (
      !draft.awaitingAgeConfirmation ||
      !normalizeLocalDisplayName(draft.displayName)
    )
      return <Navigate to="/setup" replace ignoreBlocker />;
  }
  return (
    <AgeConfirmationBoundary
      pending={pending}
      dialog={
        draft && state.status === "ready" ? (
          <LocalAgeConfirmation
            key={state.principalId}
            ownerId={state.principalId}
            draft={draft}
          />
        ) : null
      }
    >
      {children}
    </AgeConfirmationBoundary>
  );
}

/** The app can prepare its avatar, but only this dialog completes onboarding. */
function LocalAgeConfirmation({
  ownerId,
  draft,
}: {
  ownerId: string;
  draft: SetupDraft;
}) {
  const { t } = useTranslation("setup");
  const { completeOnboarding } = useLocalRuntime();
  const navigate = useNavigate();
  const capabilities = useRuntimeCapabilities();
  const { modelConfiguration } = modelSettingsAvailability(capabilities.data);
  const queryClient = useQueryClient();

  const backToSetup = () => {
    writeSetupDraft(ownerId, { ...draft, awaitingAgeConfirmation: false });
    void navigate({ to: "/setup", replace: true });
  };
  const confirm = async () => {
    // Only this explicit button press supplies true. A restored wizard draft
    // never supplies the attestation, even if an older draft recorded one.
    await completeOnboarding({
      displayName: normalizeLocalDisplayName(draft.displayName)!,
      adultConfirmed: true,
      ...(modelConfiguration && draft.chatModelId
        ? { chatModelProviderId: draft.chatModelId }
        : {}),
    });
    clearSetupDraft(ownerId);
    for (const queryKey of [
      queryKeys.userProfile.all(ownerId),
      queryKeys.settings.all(ownerId),
      queryKeys.animas.all(ownerId),
      queryKeys.modelConfiguration.all(ownerId),
      queryKeys.modelProviders.all(ownerId),
    ])
      void queryClient.invalidateQueries({ queryKey });
  };

  return (
    <AgeConfirmationDialog
      confirm={confirm}
      canConfirm={capabilities.isSuccess}
      agreement={{
        text: (
          <Trans
            t={t}
            i18nKey="ageConfirmation.agreement"
            components={{
              terms: <ModelLink href={TERMS_URL} />,
              privacy: <ModelLink href={PRIVACY_URL} />,
            }}
          />
        ),
        confirmLabel: t("ageConfirmation.confirmAndAgree"),
      }}
      failure={(cause) =>
        modelConfigurationErrorCode(cause) === "chat_model_unavailable"
          ? t("ageConfirmation.errors.modelUnavailable")
          : t("ageConfirmation.errors.saveFailed")
      }
    >
      {({ submitting }) => (
        <>
          {capabilities.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {t("ageConfirmation.errors.capabilitiesFailed")}
              </p>
              <Button
                variant="outline"
                disabled={capabilities.isFetching}
                onClick={() => void capabilities.refetch()}
              >
                {t("ageConfirmation.retry")}
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={submitting}
            onClick={backToSetup}
            className="text-muted-foreground h-auto w-fit justify-start p-0 text-xs"
          >
            {t("ageConfirmation.backToSetup")}
          </Button>
        </>
      )}
    </AgeConfirmationDialog>
  );
}
