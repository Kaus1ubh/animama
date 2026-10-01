import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";

import { useLocalRuntime } from "@web/app/local-runtime/LocalRuntimeProvider";
import { AppShell } from "@/ui/app/AppShell";
import { ContentPreviewDockProvider } from "@/ui/content-preview/ContentPreviewDockProvider";
import { SettingsGate } from "@/ui/settings/SettingsGate";
import { DesktopUpdatesPanel } from "@/ui/settings/DesktopUpdatesPanel";
import { SidebarShell } from "@/ui/sidebar";

export const Route = createFileRoute("/_app")({
  component: ApplicationAreaLayout,
});

function ApplicationAreaLayout() {
  const { state } = useLocalRuntime();
  if (state.status !== "ready") return null;
  // The app home is also the entry route; continue an accepted entry
  // navigation without reopening a departing creator's blocker.
  if (!state.firstRunComplete)
    return <Navigate to="/setup" replace ignoreBlocker />;
  return (
    <SettingsGate>
      <AppShell>
        <ContentPreviewDockProvider>
          <SidebarShell />
          <Outlet />
          <DesktopUpdatesPanel notice />
        </ContentPreviewDockProvider>
      </AppShell>
    </SettingsGate>
  );
}
