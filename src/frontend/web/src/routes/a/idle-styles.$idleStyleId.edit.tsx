import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { IdleStyleEditorPage } from "@/ui/creator/IdleStyleEditorPage";

export const Route = createFileRoute("/a/idle-styles/$idleStyleId/edit")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { duplicate?: boolean } => ({
    duplicate: search.duplicate === true || search.duplicate === "true",
  }),
  component: EditIdleStyleRoute,
});

function EditIdleStyleRoute() {
  const { idleStyleId } = Route.useParams();
  const { duplicate } = Route.useSearch();
  return (
    <AppShellPage>
      <IdleStyleEditorPage
        key={`${idleStyleId}:${duplicate}`}
        itemId={idleStyleId}
        duplicate={duplicate}
      />
    </AppShellPage>
  );
}
