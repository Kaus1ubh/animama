import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { sortAnimasByRecent } from "@/lib/anima-profile";
import { resolveFirstOwnedAnimaId } from "@/lib/animas/anima-management-search";
import { useAnimas } from "@/query/hooks/useAnimas";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";
import { Card, CardContent } from "@/ui/components/card";
import { useRuntimeAdmission } from "@/app/runtime/RuntimeAdmissionProvider";
import { EmptyAnimaRoster } from "@/ui/animas/EmptyAnimaRoster";

export const Route = createFileRoute("/_app/animas/")({
  component: AnimaResolverRoute,
});

/**
 * Resolves the roster URL to a canonical Anima details URL, or creation when
 * the owned list is empty. Selection is derived only from the owned list.
 */
function AnimaResolverRoute() {
  const { t } = useTranslation("app");
  const navigate = useNavigate({ from: "/animas/" });
  const animasQuery = useAnimas();
  const { admission } = useRuntimeAdmission();
  const creationAllowed =
    admission.status === "ready" && admission.capabilities.anima_creation;
  const redirectStarted = useRef(false);
  const firstAnimaId = resolveFirstOwnedAnimaId(
    sortAnimasByRecent(animasQuery.data ?? []).map((anima) => anima.id),
  );

  useEffect(() => {
    if (
      redirectStarted.current ||
      animasQuery.isPending ||
      animasQuery.isError ||
      (!firstAnimaId && !creationAllowed)
    ) {
      return;
    }
    redirectStarted.current = true;
    if (firstAnimaId) {
      void navigate({
        to: "/animas/$animaId",
        params: { animaId: firstAnimaId },
        search: { tab: "overview" },
        replace: true,
      });
      return;
    }
    void navigate({ to: "/animas/new", replace: true });
  }, [
    animasQuery.isError,
    animasQuery.isPending,
    firstAnimaId,
    navigate,
    creationAllowed,
  ]);

  if (animasQuery.isSuccess && !firstAnimaId && !creationAllowed)
    return <EmptyAnimaRoster />;

  if (animasQuery.isError) {
    return (
      <AppShellPage contentClassName="max-w-2xl">
        <Card className="border-destructive/35 bg-card/90 shadow-xl shadow-black/10">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="space-y-2">
              <h1 className="text-destructive font-semibold">
                {t("animas.rosterFailed.title")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("animas.rosterFailed.description")}
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
              {t("actions.retry")}
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
              {t("animas.resolving.title")}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("animas.resolving.description")}
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShellPage>
  );
}
