import {
  Outlet,
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";

import {
  normalizeAnimaDetailsSearch,
  type AnimaDetailsSearch,
  type AnimaDetailsSearchInput,
} from "@/lib/animas/anima-management-search";
import { AnimaDetailsPage } from "@/ui/animas/AnimaDetailsPage";
import { useRuntimeFeatureEnabled } from "@/ui/app/RuntimeFeatureGate";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";

export const Route = createFileRoute("/_app/animas/$animaId")({
  validateSearch: (search: AnimaDetailsSearchInput): AnimaDetailsSearch =>
    normalizeAnimaDetailsSearch(search),
  search: {
    middlewares: [
      stripSearchParams<
        Omit<AnimaDetailsSearchInput, "__TSearchSchemaInput__">
      >({ tab: "overview" }),
    ],
  },
  component: AnimaDetailsRoute,
});

function AnimaDetailsRoute() {
  const { animaId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/animas/$animaId" });
  const animaCreation = useRuntimeFeatureEnabled("anima_creation");

  return (
    <ContentPreviewExclusiveCanvasGate
      key={animaId}
      ownerId={`anima-management:${animaId}`}
    >
      <AnimaDetailsPage
        animaId={animaId}
        activeTab={tab}
        onTabChange={(nextTab) => {
          void navigate({
            search: { tab: nextTab },
          });
        }}
        onSelectAnima={(nextAnimaId, nextTab) => {
          void navigate({
            to: "/animas/$animaId",
            params: { animaId: nextAnimaId },
            search: { tab: nextTab },
          });
        }}
        onCreateAnima={
          animaCreation
            ? () => {
                void navigate({ to: "/animas/new" });
              }
            : undefined
        }
      />
      <Outlet />
    </ContentPreviewExclusiveCanvasGate>
  );
}
