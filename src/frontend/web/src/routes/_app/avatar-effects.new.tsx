import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { AvatarEffectCreatorPage } from "@/ui/avatar-effect-creator/AvatarEffectCreatorPage";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";

export const Route = createFileRoute("/_app/avatar-effects/new")({
  component: NewAvatarEffectRoute,
});

function NewAvatarEffectRoute() {
  return (
    <AppShellPage
      sidebarBehavior="adaptive-canvas"
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
    >
      <ContentPreviewExclusiveCanvasGate ownerId="avatar-effect-creator:new">
        <AvatarEffectCreatorPage />
      </ContentPreviewExclusiveCanvasGate>
    </AppShellPage>
  );
}
