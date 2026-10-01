import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { GestureEditorPage } from "@/ui/gesture-editor/GestureEditorPage";

export const Route = createFileRoute("/_app/gestures/$gestureId/edit")({
  component: EditGestureRoute,
});

function EditGestureRoute() {
  const { gestureId } = Route.useParams();
  return (
    <AppShellPage
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
      sidebarBehavior="adaptive-canvas"
    >
      <GestureEditorPage gestureId={gestureId} />
    </AppShellPage>
  );
}
