import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { MusicTrackEditorPage } from "@/ui/creator/MusicTrackEditorPage";

export const Route = createFileRoute("/a/music-tracks/new")({
  component: NewMusicTrackRoute,
});

function NewMusicTrackRoute() {
  return (
    <AppShellPage>
      <MusicTrackEditorPage />
    </AppShellPage>
  );
}
