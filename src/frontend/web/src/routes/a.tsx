import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";

import { useLocalRuntime } from "@web/app/local-runtime/LocalRuntimeProvider";
import { AppShell } from "@/ui/app/AppShell";
import { ContentPreviewDockProvider } from "@/ui/content-preview/ContentPreviewDockProvider";
import { SettingsGate } from "@/ui/settings/SettingsGate";
import { DesktopUpdatesPanel } from "@/ui/settings/DesktopUpdatesPanel";
import { SidebarShell } from "@/ui/sidebar";

export const Route = createFileRoute("/a")({
  component: ApplicationAreaLayout,
});

function ApplicationAreaLayout() {
  const { state } = useLocalRuntime();
  if (state.status !== "ready") return null;
  if (!state.firstRunComplete) return <Navigate to="/setup" replace />;
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
