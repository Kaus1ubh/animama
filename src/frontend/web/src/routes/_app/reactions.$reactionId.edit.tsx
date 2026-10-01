import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { ReactionEditorPage } from "@/ui/reaction-editor/ReactionEditorPage";

export const Route = createFileRoute("/_app/reactions/$reactionId/edit")({
  component: EditReactionRoute,
});

function EditReactionRoute() {
  const { reactionId } = Route.useParams();
  return (
    <AppShellPage
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
      sidebarBehavior="adaptive-canvas"
    >
      <ReactionEditorPage reactionId={reactionId} />
    </AppShellPage>
  );
}
