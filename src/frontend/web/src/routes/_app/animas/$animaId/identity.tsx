import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";

import {
  normalizeAnimaDetailsSearch,
  type AnimaDetailsSearch,
  type AnimaDetailsSearchInput,
} from "@/lib/animas/anima-management-search";
import { MemoryEntryEditorModal } from "@/ui/memory/MemoryEntryEditorModal";

export const Route = createFileRoute("/_app/animas/$animaId/identity")({
  validateSearch: (search: AnimaDetailsSearchInput): AnimaDetailsSearch => {
    void search;
    return normalizeAnimaDetailsSearch({ tab: "overview" });
  },
  search: {
    middlewares: [
      stripSearchParams<
        Omit<AnimaDetailsSearchInput, "__TSearchSchemaInput__">
      >({ tab: "overview" }),
    ],
  },
  component: AnimaIdentityEditorRoute,
});

function AnimaIdentityEditorRoute() {
  const { animaId } = Route.useParams();
  const navigate = useNavigate({ from: "/animas/$animaId/identity" });

  return (
    <MemoryEntryEditorModal
      animaId={animaId}
      path="IDENTITY.md"
      allowedScope="anima"
      onClose={() => {
        void navigate({
          to: "/animas/$animaId",
          params: { animaId },
          search: { tab: "overview" },
        }).then(() => {
          window.requestAnimationFrame(() => {
            document.getElementById("anima-identity-edit-trigger")?.focus();
          });
        });
      }}
    />
  );
}
