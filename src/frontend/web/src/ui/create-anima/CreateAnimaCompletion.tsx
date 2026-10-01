import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { offerCreationRuntime } from "@/lib/runtime-content/creationRuntimeHandoff";
import {
  RuntimeMountPreparer,
  type PreparedRuntimeMount,
  type RuntimePreparationProgress,
} from "@/lib/runtime-content/RuntimeMountPreparer";
import { fetchAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"preparing" | "degraded" | "error">(
    "preparing",
  );
  const [progress, setProgress] = useState<RuntimePreparationProgress | null>(
    null,
  );
  const [message, setMessage] = useState("");
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
    setMessage("");
    void (async () => {
      try {
        const typed = await fetchAnimaRuntimeCatalog(animaId, signal);
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
          setMessage(
            mount.diagnostics.map((item) => item.message).join(" ") ||
              "Some runtime content is unavailable. Your Anima was created successfully.",
          );
        } else await navigate({ to: "/$animaId", params: { animaId } });
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "The first chat could not be opened.",
          );
        }
      }
    })();
    return () => {
      controller.abort();
      if (!transferred) mount?.dispose();
    };
  }, [animaId, attempt, navigate, onConsumed, owner, queryClient]);
  return (
    <section
      className="mx-auto max-w-xl space-y-5 p-6 sm:p-10"
      aria-labelledby="creation-complete-heading"
    >
      <h1 id="creation-complete-heading" className="text-2xl font-semibold">
        Your Anima is created
      </h1>
      <p className="text-muted-foreground text-sm">
        Creation is complete. Opening the first chat cannot create another
        Anima.
      </p>
      {status === "preparing" ? (
        <div role="status" className="space-y-3">
          <p>Preparing the first chat…</p>
          {progress ? (
            <>
              <progress
                className="accent-primary h-2 w-full"
                value={progress.completedMembers}
                max={Math.max(1, progress.totalMembers)}
              />
              <p className="text-muted-foreground text-xs">
                {progress.completedMembers} / {progress.totalMembers} files
                verified
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <div role="alert" className="space-y-4">
          <p className="text-sm break-words">{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Retry opening Anima
            </Button>
            <Button variant="outline" asChild>
              <Link to="/$animaId" params={{ animaId }}>
                Open Anima anyway
              </Link>
            </Button>
          </div>
        </div>
      )}
      <Button variant="ghost" asChild>
        <Link to="/create">Creator hub</Link>
      </Button>
    </section>
  );
}
