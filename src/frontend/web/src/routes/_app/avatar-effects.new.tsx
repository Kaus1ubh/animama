import { createFileRoute } from "@tanstack/react-router";

import { parseAvatarEffectTemplateSearch } from "@/lib/effects/effectTemplates";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { AvatarEffectCreatorPage } from "@/ui/avatar-effect-creator/AvatarEffectCreatorPage";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";

/**
 * `/avatar-effects/new[?template=<id>]`: a new Avatar Effect, blank or seeded
 * from an Included template. The page is keyed by template, so choosing
 * another template starts a separate draft.
 */
export const Route = createFileRoute("/_app/avatar-effects/new")({
  validateSearch: parseAvatarEffectTemplateSearch,
  component: NewAvatarEffectRoute,
});

function NewAvatarEffectRoute() {
  const { template } = Route.useSearch();
  return (
    <AppShellPage
      sidebarBehavior="adaptive-canvas"
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
    >
      <ContentPreviewExclusiveCanvasGate ownerId="avatar-effect-creator:new">
        <AvatarEffectCreatorPage
          key={`new:${template ?? ""}`}
          templateId={template}
        />
      </ContentPreviewExclusiveCanvasGate>
    </AppShellPage>
  );
}
