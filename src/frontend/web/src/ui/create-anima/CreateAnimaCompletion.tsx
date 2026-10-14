import { useProductApiClient } from "@animama/product-ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  apiErrorText,
  readApiError,
  type ApiErrorInfo,
} from "@/lib/errors/apiError";
import { offerCreationRuntime } from "@/lib/runtime-content/creationRuntimeHandoff";
import {
  RuntimeMountPreparer,
  type PreparedRuntimeMount,
  type RuntimePreparationProgress,
} from "@/lib/runtime-content/RuntimeMountPreparer";
import { fetchAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";

/**
 * What went wrong, worded at render: runtime diagnostics and preparation
 * errors are developer English, shown as is in English and as secondary
 * detail under a translated message elsewhere.
 */
type CompletionProblem = { kind: "degraded" | "error"; info: ApiErrorInfo };

/** Mounted only after the creator stage has unmounted. Never calls creation again. */
export function CreateAnimaCompletion({
  owner,
  animaId,
  onConsumed,
}: {
  owner: string;
  animaId: string;
  onConsumed: (animaId: string) => void;
}) {
  const { t } = useTranslation("create");
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"preparing" | "degraded" | "error">(
    "preparing",
  );
  const [progress, setProgress] = useState<RuntimePreparationProgress | null>(
    null,
  );
  const [problem, setProblem] = useState<CompletionProblem | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(90_000),
    ]);
    let mount: PreparedRuntimeMount | null = null;
    let transferred = false;
    setStatus("preparing");
    setProgress(null);
    setProblem(null);
    void (async () => {
      try {
        const typed = await fetchAnimaRuntimeCatalog(
          apiClient,
          animaId,
          signal,
        );
        mount = await new RuntimeMountPreparer().prepare(typed, {
          signal,
          onProgress: (next) => {
            if (!controller.signal.aborted) setProgress(next);
          },
        });
        if (controller.signal.aborted) {
          mount.dispose();
          return;
        }
        queryClient.setQueryData(
          queryKeys.animaLoadouts.runtime(owner, animaId),
          typed,
        );
        offerCreationRuntime(owner, animaId, typed, mount, () =>
          onConsumed(animaId),
        );
        transferred = true;
        if (mount.playbackStatus === "degraded" || typed.can_chat === false) {
          setStatus("degraded");
          setProblem({
            kind: "degraded",
            info: {
              status: null,
              code: null,
              reason: null,
              field: null,
              params: {},
              message:
                mount.diagnostics.map((item) => item.message).join(" ") || null,
            },
          });
        } else await navigate({ to: "/$animaId", params: { animaId } });
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus("error");
          setProblem({ kind: "error", info: readApiError(error) });
        }
      }
    })();
    return () => {
      controller.abort();
      if (!transferred) mount?.dispose();
    };
  }, [apiClient, animaId, attempt, navigate, onConsumed, owner, queryClient]);
  const problemText = problem
    ? apiErrorText(
        problem.info,
        "creation",
        problem.kind === "degraded"
          ? t("completion.degraded")
          : t("completion.openFailed"),
      )
    : null;
  return (
    <section
      className="mx-auto max-w-xl space-y-5 p-6 sm:p-10"
      aria-labelledby="creation-complete-heading"
    >
      <h1 id="creation-complete-heading" className="text-2xl font-semibold">
        {t("completion.title")}
      </h1>
      <p className="text-muted-foreground text-sm">
        {t("completion.description")}
      </p>
      {status === "preparing" ? (
        <div role="status" className="space-y-3">
          <p>{t("completion.preparing")}</p>
          {progress ? (
            <>
              <progress
                className="accent-primary h-2 w-full"
                value={progress.completedMembers}
                max={Math.max(1, progress.totalMembers)}
              />
              <p className="text-muted-foreground text-xs">
                {t("completion.filesVerified", {
                  completed: progress.completedMembers,
                  count: progress.totalMembers,
                })}
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <div role="alert" className="space-y-4">
          {problemText ? (
            <p className="text-sm break-words">
              {problemText.message}
              {problemText.detail ? (
                <span className="text-muted-foreground mt-1 block text-xs">
                  {problemText.detail}
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAttempt((value) => value + 1)}>
              {t("completion.retry")}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/$animaId" params={{ animaId }}>
                {t("completion.openAnyway")}
              </Link>
            </Button>
          </div>
        </div>
      )}
      <Button variant="ghost" asChild>
        <Link to="/create">{t("actions.creatorHub")}</Link>
      </Button>
    </section>
  );
}
