import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLocalRuntime } from "../LocalRuntimeProvider";
import { useRuntimeAdmission } from "../../runtime/RuntimeAdmissionProvider";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import {
  modelConfigurationErrorCode,
  modelSettingsAvailability,
} from "@/ui/settings/models/model-configuration-state";

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
    <>
      {/* Keep this boundary stable so accepting never remounts the loaded app. */}
      <div className="contents" inert={pending}>
        {children}
      </div>
      {pending && draft && state.status === "ready" ? (
        <AgeConfirmation
          key={state.principalId}
          ownerId={state.principalId}
          draft={draft}
        />
      ) : null}
    </>
  );
}

/** Why completing onboarding failed; worded at render in the UI Locale. */
type AgeConfirmationFailure = "modelUnavailable" | "saveFailed";

/** The app can prepare its avatar, but only this dialog completes onboarding. */
function AgeConfirmation({
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
  const [declined, setDeclined] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AgeConfirmationFailure | null>(null);

  const backToSetup = () => {
    writeSetupDraft(ownerId, { ...draft, awaitingAgeConfirmation: false });
    void navigate({ to: "/setup", replace: true });
  };
  const confirm = async () => {
    if (submitting || !capabilities.isSuccess) return;
    setSubmitting(true);
    setError(null);
    try {
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
    } catch (cause) {
      setError(
        modelConfigurationErrorCode(cause) === "chat_model_unavailable"
          ? "modelUnavailable"
          : "saveFailed",
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
      >
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
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error === "modelUnavailable"
              ? t("ageConfirmation.errors.modelUnavailable")
              : t("ageConfirmation.errors.saveFailed")}
          </p>
        ) : null}
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
        <DialogFooter>
          {declined ? (
            <Button variant="outline" onClick={() => setDeclined(false)}>
              {t("ageConfirmation.goBack")}
            </Button>
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
                disabled={submitting || !capabilities.isSuccess}
                onClick={() => void confirm()}
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
