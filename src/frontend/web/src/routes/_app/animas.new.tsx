import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
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
 * roster resolvers also land here and a redirect could loop. Unlike the
 * entry-point links, the creator waits for the first capabilities response so
 * a disabled runtime never starts creator drafts or catalog queries.
 */
function CreateAnimaRoute() {
  const { t } = useTranslation("app");
  const { avatar } = Route.useSearch();
  const capabilitiesLoading = useRuntimeCapabilities().isLoading;
  const animaCreation = useRuntimeFeatureEnabled("anima_creation");
  if (capabilitiesLoading) return null;
  if (!animaCreation) {
    return (
      <AppShellPage contentClassName="max-w-xl text-center">
        <h1 className="text-lg font-semibold">
          {t("animas.creationUnavailable.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("animas.creationUnavailable.description")}
        </p>
      </AppShellPage>
    );
  }
  return <CreateAnimaPage avatar={avatar} />;
}
