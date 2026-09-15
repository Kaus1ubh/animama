import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { sortAnimasByRecent } from "@/lib/anima-profile";
import { resolveFirstOwnedAnimaId } from "@/lib/animas/anima-management-search";
import { useAnimas } from "@/query/hooks/useAnimas";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";
import { Card, CardContent } from "@/ui/components/card";

export const Route = createFileRoute("/a/animas/")({
  component: AnimaResolverRoute,
});

/**
 * Resolves the roster URL to a canonical Anima details URL, or creation when
 * the owned list is empty. Selection is derived only from the owned list.
 */
function AnimaResolverRoute() {
  const navigate = useNavigate({ from: "/a/animas/" });
  const animasQuery = useAnimas();
  const redirectStarted = useRef(false);
  const firstAnimaId = resolveFirstOwnedAnimaId(
    sortAnimasByRecent(animasQuery.data ?? []).map((anima) => anima.id),
  );

  useEffect(() => {
    if (
      redirectStarted.current ||
      animasQuery.isPending ||
      animasQuery.isError
    ) {
      return;
    }
    redirectStarted.current = true;
    if (firstAnimaId) {
      void navigate({
        to: "/a/animas/$animaId",
        params: { animaId: firstAnimaId },
        search: { tab: "overview" },
        replace: true,
      });
      return;
    }
    void navigate({ to: "/a/animas/new", replace: true });
  }, [animasQuery.isError, animasQuery.isPending, firstAnimaId, navigate]);

  if (animasQuery.isError) {
    return (
      <AppShellPage contentClassName="max-w-2xl">
        <Card className="border-destructive/35 bg-card/90 shadow-xl shadow-black/10">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="space-y-2">
              <h1 className="text-destructive font-semibold">
                Your Animas could not be loaded
              </h1>
              <p className="text-muted-foreground text-sm">
                Retry the owned-Anima list without leaving this page.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                redirectStarted.current = false;
                void animasQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </AppShellPage>
    );
  }

  return (
    <AppShellPage contentClassName="max-w-2xl">
      <Card className="border-border/70 bg-card/90 shadow-xl shadow-black/10">
        <CardContent className="flex min-h-64 items-center justify-center p-8 text-center">
          <div className="space-y-2">
            <p className="text-foreground font-medium">
              Opening Anima management
            </p>
            <p className="text-muted-foreground text-sm">
              Resolving your first owned Anima…
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShellPage>
  );
}
