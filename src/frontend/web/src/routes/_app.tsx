import {
  Navigate,
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useRuntimeAdmission } from "@web/app/runtime/RuntimeAdmissionProvider";
import {
  unavailableReasonText,
  unavailableRouteReason,
} from "@web/app/runtime/route-admission";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { AppShell } from "@/ui/app/AppShell";
import { ContentPreviewDockProvider } from "@/ui/content-preview/ContentPreviewDockProvider";
import { SettingsGate } from "@/ui/settings/SettingsGate";
import { DesktopUpdatesPanel } from "@/ui/settings/DesktopUpdatesPanel";
import { SidebarShell } from "@/ui/sidebar";

export const Route = createFileRoute("/_app")({
  component: ApplicationAreaLayout,
});

function ApplicationAreaLayout() {
  const { t } = useTranslation("app");
  const { admission } = useRuntimeAdmission();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (admission.status !== "ready") return null;
  // The app home is also the entry route; continue an accepted entry
  // navigation without reopening a departing creator's blocker.
  if (admission.onboardingRequired)
    return <Navigate to="/setup" replace ignoreBlocker />;
  const reason = unavailableRouteReason(pathname, admission.capabilities);
  return (
    <SettingsGate>
      <AppShell>
        <ContentPreviewDockProvider>
          <SidebarShell />
          {reason ? (
            <AppShellPage>
              <h1 className="text-lg font-semibold">
                {t("unavailable.title")}
              </h1>
              <p className="text-muted-foreground">
                {unavailableReasonText(reason, t)}
              </p>
            </AppShellPage>
          ) : (
            <Outlet />
          )}
          <DesktopUpdatesPanel notice />
        </ContentPreviewDockProvider>
      </AppShell>
    </SettingsGate>
  );
}
