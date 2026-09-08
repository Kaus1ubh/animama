import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { IdleStyleEditorPage } from "@/ui/creator/IdleStyleEditorPage";

export const Route = createFileRoute("/a/idle-styles/new")({
  component: NewIdleStyleRoute,
});

function NewIdleStyleRoute() {
  return (
    <AppShellPage>
      <IdleStyleEditorPage />
    </AppShellPage>
  );
}
