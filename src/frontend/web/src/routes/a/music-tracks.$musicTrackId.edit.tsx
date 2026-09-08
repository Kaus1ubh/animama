import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { MusicTrackEditorPage } from "@/ui/creator/MusicTrackEditorPage";

export const Route = createFileRoute("/a/music-tracks/$musicTrackId/edit")({
  component: EditMusicTrackRoute,
});

function EditMusicTrackRoute() {
  const { musicTrackId } = Route.useParams();
  return (
    <AppShellPage>
      <MusicTrackEditorPage itemId={musicTrackId} />
    </AppShellPage>
  );
}
