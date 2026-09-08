import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { IdleStyleEditorPage } from "@/ui/creator/IdleStyleEditorPage";

export const Route = createFileRoute("/a/idle-styles/$idleStyleId/edit")({
  component: EditIdleStyleRoute,
});

function EditIdleStyleRoute() {
  const { idleStyleId } = Route.useParams();
  return (
    <AppShellPage>
      <IdleStyleEditorPage itemId={idleStyleId} />
    </AppShellPage>
  );
}
