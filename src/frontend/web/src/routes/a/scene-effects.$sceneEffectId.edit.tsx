import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";
import { SceneEffectCreatorPage } from "@/ui/scene-effect-creator/SceneEffectCreatorPage";

export const Route = createFileRoute("/a/scene-effects/$sceneEffectId/edit")({
  component: EditSceneEffectRoute,
});

function EditSceneEffectRoute() {
  const { sceneEffectId } = Route.useParams();
  return (
    <AppShellPage
      sidebarBehavior="adaptive-canvas"
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
    >
      <ContentPreviewExclusiveCanvasGate
        ownerId={`scene-effect-creator:${sceneEffectId}`}
      >
        <SceneEffectCreatorPage itemId={sceneEffectId} />
      </ContentPreviewExclusiveCanvasGate>
    </AppShellPage>
  );
}
