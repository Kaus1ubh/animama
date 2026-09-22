import { createFileRoute } from "@tanstack/react-router";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { PoseEditorPage } from "@/ui/pose-editor/PoseEditorPage";

export const Route = createFileRoute("/a/poses/$poseId/edit")({
  component: EditPoseRoute,
});

function EditPoseRoute() {
  const { poseId } = Route.useParams();
  return (
    <AppShellPage
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
      sidebarBehavior="adaptive-canvas"
    >
      <PoseEditorPage poseId={poseId} />
    </AppShellPage>
  );
}
