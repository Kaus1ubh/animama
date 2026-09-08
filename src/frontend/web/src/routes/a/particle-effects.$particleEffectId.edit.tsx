import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";
import { ParticleVFXCreatorPage } from "@/ui/particle-vfx-creator/ParticleVFXCreatorPage";

export const Route = createFileRoute(
  "/a/particle-effects/$particleEffectId/edit",
)({ component: EditParticleEffectRoute });

function EditParticleEffectRoute() {
  const { particleEffectId } = Route.useParams();
  return (
    <AppShellPage
      sidebarBehavior="adaptive-canvas"
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
    >
      <ContentPreviewExclusiveCanvasGate
        ownerId={`particle-effect-creator:${particleEffectId}`}
      >
        <ParticleVFXCreatorPage itemId={particleEffectId} />
      </ContentPreviewExclusiveCanvasGate>
    </AppShellPage>
  );
}
