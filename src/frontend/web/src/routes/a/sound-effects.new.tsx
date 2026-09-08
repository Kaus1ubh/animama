import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { ComponentEditorPage } from "@/ui/creator/ComponentEditorPage";

export const Route = createFileRoute("/a/sound-effects/new")({
  component: NewSoundEffectRoute,
});

function NewSoundEffectRoute() {
  return (
    <AppShellPage>
      <ComponentEditorPage family="sound" />
    </AppShellPage>
  );
}
