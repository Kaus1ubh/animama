import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { useRuntimeFeatureEnabled } from "@/ui/app/RuntimeFeatureGate";
import { CreateAnimaPage } from "@/ui/create-anima/CreateAnimaPage";
import { parseCreateAnimaSearch } from "@/ui/create-anima/createAnimaSearch";

export const Route = createFileRoute("/_app/animas/new")({
  validateSearch: parseCreateAnimaSearch,
  component: CreateAnimaRoute,
});

/**
 * Mount the creator only while the runtime offers Anima creation. A disabled
 * runtime shows a static notice rather than redirecting, because the empty
 * roster resolvers also land here and a redirect could loop.
 */
function CreateAnimaRoute() {
  const { avatar } = Route.useSearch();
  const animaCreation = useRuntimeFeatureEnabled("anima_creation");
  if (!animaCreation) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <h1 className="text-lg font-semibold">
          Anima creation is not available
        </h1>
        <p className="text-muted-foreground">
          This Animama runtime does not offer creating new Animas.
        </p>
      </AppShellPage>
    );
  }
  return <CreateAnimaPage avatar={avatar} />;
}
