import { createFileRoute, Navigate } from "@tanstack/react-router";

import { resolveStartupAnimaId } from "@/lib/animas/anima-management-search";
import { readDefaultAnimaId } from "@/lib/settings/preferences";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useUserSettings } from "@/query/hooks/useUserSettings";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";

export const Route = createFileRoute("/a/")({
  component: ChatLaunchRoute,
});

/** Open the pinned or remembered owned Anima only after both startup reads settle. */
function ChatLaunchRoute() {
  const animas = useAnimas();
  const settings = useUserSettings();

  if (animas.isError || settings.isError) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <h1 className="text-lg font-semibold">
          Your Anima could not be opened
        </h1>
        <p className="text-muted-foreground">
          Animama could not load your Animas or saved selection. Please try
          again.
        </p>
        <Button
          variant="outline"
          disabled={animas.isFetching || settings.isFetching}
          onClick={() => {
            if (animas.isError) void animas.refetch();
            if (settings.isError) void settings.refetch();
          }}
        >
          Retry
        </Button>
      </AppShellPage>
    );
  }

  // Choosing a fallback before settings arrive would overwrite the last Anima.
  if (!animas.isSuccess || !settings.isSuccess) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <p role="status">Opening your Anima…</p>
      </AppShellPage>
    );
  }

  const animaId = resolveStartupAnimaId(
    animas.data.map((anima) => anima.id),
    {
      pinnedAnimaId: readDefaultAnimaId(settings.data.preferences),
      lastActiveAnimaId: settings.data.last_active_anima_id,
    },
  );
  // Continue the accepted entry navigation without reopening a departing
  // creator's blocker before its passive-effect cleanup has run.
  return animaId ? (
    <Navigate to="/a/$animaId" params={{ animaId }} replace ignoreBlocker />
  ) : (
    <Navigate to="/a/animas/new" replace ignoreBlocker />
  );
}
