import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { ComponentEditorPage } from "@/ui/creator/ComponentEditorPage";

export const Route = createFileRoute("/a/sound-effects/$soundEffectId/edit")({
  component: EditSoundEffectRoute,
});

function EditSoundEffectRoute() {
  const { soundEffectId } = Route.useParams();
  return (
    <AppShellPage>
      <ComponentEditorPage family="sound" itemId={soundEffectId} />
    </AppShellPage>
  );
}
