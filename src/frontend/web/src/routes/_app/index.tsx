import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { resolveSelectedAnimaId } from "@/lib/animas/anima-management-search";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useUserSettings } from "@/query/hooks/useUserSettings";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { useRuntimeAdmission } from "@/app/runtime/RuntimeAdmissionProvider";
import { Button } from "@/ui/components/button";
import { EmptyAnimaRoster } from "@/ui/animas/EmptyAnimaRoster";

export const Route = createFileRoute("/_app/")({
  component: ChatLaunchRoute,
});

/** Open the last opened owned Anima only after both startup reads settle. */
function ChatLaunchRoute() {
  const { t } = useTranslation("app");
  const { admission } = useRuntimeAdmission();
  const animas = useAnimas();
  const settings = useUserSettings();

  if (animas.isError || settings.isError) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <h1 className="text-lg font-semibold">{t("launch.failed.title")}</h1>
        <p className="text-muted-foreground">
          {t("launch.failed.description")}
        </p>
        <Button
          variant="outline"
          disabled={animas.isFetching || settings.isFetching}
          onClick={() => {
            if (animas.isError) void animas.refetch();
            if (settings.isError) void settings.refetch();
          }}
        >
          {t("actions.retry")}
        </Button>
      </AppShellPage>
    );
  }

  // Choosing a fallback before settings arrive would overwrite the last Anima.
  if (!animas.isSuccess || !settings.isSuccess) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <p role="status">{t("launch.opening")}</p>
      </AppShellPage>
    );
  }

  // The last opened Anima when it is still owned, otherwise the first.
  const animaId = resolveSelectedAnimaId(
    animas.data.map((anima) => anima.id),
    settings.data.last_active_anima_id,
  );
  // Continue the accepted entry navigation without reopening a departing
  // creator's blocker before its passive-effect cleanup has run.
  if (
    !animaId &&
    admission.status === "ready" &&
    !admission.capabilities.anima_creation
  )
    return <EmptyAnimaRoster />;
  return animaId ? (
    <Navigate to="/$animaId" params={{ animaId }} replace ignoreBlocker />
  ) : (
    <Navigate to="/animas/new" replace ignoreBlocker />
  );
}
