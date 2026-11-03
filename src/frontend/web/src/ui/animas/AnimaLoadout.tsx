import { useProductApiClient } from "@animama/product-ui";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  previewGesture,
  previewReaction,
} from "@animama/runtime-contracts/sdk";
import type {
  PyCatalogLoadoutSource,
  PyGestureIntent,
  PyIdleIntent,
  PyIdleMember,
  PyLoadoutPlan,
  PyReactionIntent,
  PyReactionMember,
} from "@animama/runtime-contracts/api-types";
import type { TFunction } from "i18next";
import type {
  PyExactContentSource,
  PyGesture,
  PyReaction,
} from "@/lib/content/catalogTypes";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import { withLibraryPreviewAnimaContext } from "@/lib/content-preview/targets";
import {
  loadoutFailureText,
  loadoutWarningText,
  poolChangeFailureText,
} from "@/lib/errors/loadoutErrors";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import { idlePreviewTarget } from "@/lib/content-preview/idlePreviewTarget";
import {
  typedActionPreview,
  typedIdleGesturePreview,
} from "@/lib/content/typedPreviewAdapters";
import { presentGestureCatalog } from "@/lib/loadout/animaLoadoutPresentation";
import { idleAddIntent } from "@/lib/loadout/idleLoadoutGrid";
import {
  buildReactionLoadoutGrid,
  reactionAddIntent,
} from "@/lib/loadout/reactionLoadoutGrid";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { useAnimaLoadout as useLoadout } from "@/query/hooks/useAnimaLoadout";
import { useGestures, useReactions } from "@/query/hooks/useActions";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { useAnimaLoadoutMutations } from "@/query/mutations/useAnimaLoadoutMutations";
import { VoiceLoadoutSection } from "@/ui/animas/VoiceLoadoutSection";
import { GestureLoadoutSection } from "@/ui/animas/GestureLoadoutSection";
import { IdleLoadoutSection } from "@/ui/animas/IdleLoadoutSection";
import { ReactionLoadoutGrid } from "@/ui/animas/ReactionLoadoutGrid";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

/** A planned Gesture change awaiting confirmation; pool edits skip review. */
type ReviewedChange = {
  intent: PyGestureIntent;
  plan: PyLoadoutPlan;
  idempotencyKey: string;
};

type PreviewableAction = {
  name?: string | null;
  source?: PyExactContentSource | PyCatalogLoadoutSource | null;
};

/** Toast a failed Loadout request, worded from its code, with any detail below. */
function toastLoadoutFailure(error: unknown, fallback: string) {
  const text = loadoutFailureText(error, fallback);
  toast.error(text.message, { description: text.detail ?? undefined });
}

/** Toast a failed pool edit; a stale revision only asks for a retry. */
function toastPoolChangeFailure(
  error: unknown,
  changedElsewhere: string,
  fallback: string,
) {
  const text = poolChangeFailureText(error, changedElsewhere, fallback);
  toast.error(text.message, { description: text.detail ?? undefined });
}

/** Display wording for a reviewed plan's action (a backend enum). */
function planActionLabel(
  t: TFunction<"animas">,
  action: PyLoadoutPlan["action"],
): string {
  switch (action) {
    case "add":
      return t("loadout.review.actions.add");
    case "update":
      return t("loadout.review.actions.update");
    case "replace":
      return t("loadout.review.actions.replace");
    case "remove":
      return t("loadout.review.actions.remove");
    case "revert":
      return t("loadout.review.actions.revert");
    case "unchanged":
      return t("loadout.review.actions.unchanged");
  }
}

function intentSource(
  source: PyExactContentSource | PyCatalogLoadoutSource | null | undefined,
): PyCatalogLoadoutSource | null {
  if (!source || !("catalog_item_id" in source) || !source.source) return null;
  return {
    type: "catalog",
    catalog_item_id: source.catalog_item_id,
    logical_key: source.logical_key,
    source: source.source,
  };
}

/**
 * Typed Gesture, Reaction and Idle configuration; dependencies remain
 * resolver-owned. Gesture changes are reviewed; pool edits apply at once.
 */
export function AnimaLoadout({
  animaId,
  onStagePreview,
}: {
  animaId: string;
  onStagePreview: (target: ContentPreviewTarget) => void;
}) {
  const apiClient = useProductApiClient();
  const { t } = useTranslation(["animas", "errors"]);

  const query = useLoadout(animaId);
  const runtimeSnapshotQuery = useAnimaRuntimeCatalog(animaId);
  const runtimeData = useMemo(
    () =>
      runtimeSnapshotQuery.data
        ? adaptRuntimeSnapshot(runtimeSnapshotQuery.data)
        : undefined,
    [runtimeSnapshotQuery.data],
  );
  const runtimeQuery = { ...runtimeSnapshotQuery, data: runtimeData };
  const gesturesQuery = useGestures({ origin: "all", sort: "name" });
  const reactionsQuery = useReactions({ origin: "all", sort: "name" });
  const {
    fetchNextPage: fetchNextGesturesPage,
    hasNextPage: hasNextGesturesPage,
    isFetchNextPageError: gesturesNextPageError,
    isFetchingNextPage: gesturesFetchingNextPage,
  } = gesturesQuery;
  const {
    fetchNextPage: fetchNextReactionsPage,
    hasNextPage: hasNextReactionsPage,
    isFetchNextPageError: reactionsNextPageError,
    isFetchingNextPage: reactionsFetchingNextPage,
  } = reactionsQuery;
  const mutations = useAnimaLoadoutMutations(animaId);
  const [reviewed, setReviewed] = useState<ReviewedChange | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const loadout = query.data;

  useEffect(() => {
    if (
      hasNextGesturesPage &&
      !gesturesFetchingNextPage &&
      !gesturesNextPageError
    ) {
      void fetchNextGesturesPage();
    }
  }, [
    gesturesFetchingNextPage,
    gesturesNextPageError,
    fetchNextGesturesPage,
    hasNextGesturesPage,
  ]);

  useEffect(() => {
    if (
      hasNextReactionsPage &&
      !reactionsFetchingNextPage &&
      !reactionsNextPageError
    ) {
      void fetchNextReactionsPage();
    }
  }, [
    fetchNextReactionsPage,
    hasNextReactionsPage,
    reactionsFetchingNextPage,
    reactionsNextPageError,
  ]);

  const gestureCatalog = useMemo(
    () =>
      presentGestureCatalog(
        gesturesQuery.data?.pages.flatMap((page) => page.items) ?? [],
        loadout?.gestures ?? [],
      ),
    [gesturesQuery.data, loadout?.gestures],
  );
  const reactionRows = useMemo(
    () => buildReactionLoadoutGrid(loadout?.reactions ?? []),
    [loadout?.reactions],
  );
  const availableReactions = useMemo(
    () =>
      (reactionsQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (reaction) => reaction.state === "ready" && reaction.source,
      ),
    [reactionsQuery.data],
  );
  const availableGestures = useMemo(
    () => gesturesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [gesturesQuery.data],
  );

  const preview = async (
    family: "gesture" | "reaction",
    row: PreviewableAction,
  ) => {
    const catalogSource = intentSource(row.source);
    if (!catalogSource) {
      toast.error(t("loadout.noPreviewSource"));
      return;
    }
    if (!runtimeQuery.data) {
      toast.error(t("loadout.previewContextLoading"));
      return;
    }
    const runtimeData = runtimeQuery.data;
    try {
      const itemId = catalogSource.catalog_item_id;
      const options = {
        path: { item_id: itemId },
        responseValidator: undefined,
        throwOnError: true as const,
      };
      const result =
        family === "gesture"
          ? await previewGesture({ ...options, client: apiClient })
          : await previewReaction({ ...options, client: apiClient });
      const target = actionPreviewTarget(
        typedActionPreview(result.data),
        row.name ?? t("loadout.fallbackName.reaction"),
      );
      onStagePreview(
        withLibraryPreviewAnimaContext(target, animaId, runtimeData),
      );
    } catch (error) {
      toastLoadoutFailure(error, t("errors:loadout.previewUnavailable"));
    }
  };

  const planGesture = async (intent: PyGestureIntent) => {
    if (!loadout) return;
    setReviewing(true);
    try {
      const plan = await mutations.planGesture.mutateAsync({
        expected_revision: loadout.revision,
        intent,
      });
      setReviewed({
        intent,
        plan,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (error) {
      toastLoadoutFailure(error, t("errors:loadout.reviewFailed"));
    } finally {
      setReviewing(false);
    }
  };

  /** Apply one Idle pool change at once; Idle edits skip the review dialog. */
  const changeIdle = async (intent: PyIdleIntent) => {
    if (!loadout) return;
    try {
      await mutations.changeIdle.mutateAsync({
        expected_revision: loadout.revision,
        intent,
      });
    } catch (error) {
      toastPoolChangeFailure(
        error,
        t("idle.changedElsewhere"),
        t("errors:loadout.updateFailed"),
      );
    }
  };

  /** Apply one Reaction pool change at once, like Idle, without review. */
  const changeReaction = async (intent: PyReactionIntent) => {
    if (!loadout) return;
    try {
      const result = await mutations.changeReaction.mutateAsync({
        expected_revision: loadout.revision,
        intent,
      });
      // A restore can skip a starter Reaction that is unavailable.
      for (const warning of result.warnings)
        toast.warning(loadoutWarningText(warning));
    } catch (error) {
      toastPoolChangeFailure(
        error,
        t("reactions.changedElsewhere"),
        t("errors:loadout.updateFailed"),
      );
    }
  };

  /** Preview an Idle member with the exact finite clock it idles with. */
  const previewIdle = async (member: PyIdleMember) => {
    if (!runtimeQuery.data) {
      toast.error(t("loadout.previewContextLoading"));
      return;
    }
    try {
      const result = (
        await previewGesture({
          client: apiClient,
          path: { item_id: member.item_id },
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data;
      onStagePreview(
        idlePreviewTarget(
          typedIdleGesturePreview(result),
          member.name || t("loadout.fallbackName.idleGesture"),
          animaId,
          runtimeQuery.data,
        ),
      );
    } catch (error) {
      toastLoadoutFailure(error, t("errors:loadout.previewFailed"));
    }
  };

  const confirm = async () => {
    if (!loadout || !reviewed) return;
    try {
      await mutations.commitGesture.mutateAsync({
        expected_revision: loadout.revision,
        intent: reviewed.intent,
        plan_digest: reviewed.plan.plan_digest,
        idempotency_key: reviewed.idempotencyKey,
      });
      toast.success(t("loadout.updated"));
      setReviewed(null);
    } catch (error) {
      toastLoadoutFailure(error, t("errors:loadout.updateFailed"));
    }
  };

  if (query.isPending) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        {t("loadout.loading")}
      </p>
    );
  }
  if (query.isError || !loadout) {
    return (
      <div className="space-y-3 rounded-xl border p-5 text-sm">
        <p className="text-destructive">{t("loadout.unavailable")}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("actions.retry")}
        </Button>
      </div>
    );
  }
  const mutationsDisabled = reviewing;
  const committing = mutations.commitGesture.isPending;

  return (
    <div className="space-y-8 pt-5 md:pt-6">
      <h1 className="text-2xl font-semibold">{t("loadout.title")}</h1>
      {loadout.warnings?.length ? (
        <div className="border-warning/35 rounded-lg border p-3 text-sm">
          {loadout.warnings.map((warning) => (
            <p key={`${warning.code}:${warning.message}`}>
              {loadoutWarningText(warning)}
            </p>
          ))}
        </div>
      ) : null}
      <VoiceLoadoutSection key={animaId} />
      <GestureLoadoutSection
        catalog={gestureCatalog}
        catalogLoading={
          gesturesQuery.isPending ||
          gesturesFetchingNextPage ||
          Boolean(hasNextGesturesPage && !gesturesNextPageError)
        }
        catalogError={gesturesQuery.isError}
        mutationsDisabled={mutationsDisabled}
        onPreview={(row) => void preview("gesture", row)}
        onPreviewAvailable={(gesture) => void preview("gesture", gesture)}
        onEquip={(gesture: PyGesture) => {
          const source = intentSource(gesture.source);
          if (!source) {
            toast.error(t("loadout.gestureNotLocal"));
            return;
          }
          void planGesture({
            operation: "add",
            source,
            config_overrides: {},
          });
        }}
        onRemove={(row) =>
          void planGesture({
            operation: "remove",
            binding_id: row.binding_id,
            config_overrides: {},
          })
        }
        onRetryCatalog={() => void gesturesQuery.refetch()}
      />
      <ReactionLoadoutGrid
        rows={reactionRows}
        available={availableReactions}
        availableLoading={
          reactionsQuery.isPending ||
          reactionsFetchingNextPage ||
          Boolean(hasNextReactionsPage && !reactionsNextPageError)
        }
        availableError={reactionsQuery.isError}
        disabled={mutationsDisabled}
        busy={mutations.changeReaction.isPending}
        onAdd={(cell, reaction: PyReaction) => {
          const source = intentSource(reaction.source);
          if (!source) {
            toast.error(t("loadout.reactionNotLocal"));
            return;
          }
          void changeReaction(reactionAddIntent(cell, source));
        }}
        onRemove={(member: PyReactionMember) =>
          void changeReaction({
            operation: "remove",
            binding_id: member.binding_id,
          })
        }
        onRestoreStarter={(cell) =>
          void changeReaction({
            operation: "restore_starter",
            emotion: cell.emotion,
            intensity: cell.intensity,
          })
        }
        onPreview={(member) => void preview("reaction", member)}
        onPreviewAvailable={(reaction) => void preview("reaction", reaction)}
        onRetryAvailable={() => void reactionsQuery.refetch()}
      />
      <IdleLoadoutSection
        idle={loadout.idle}
        available={availableGestures}
        availableLoading={
          gesturesQuery.isPending ||
          gesturesFetchingNextPage ||
          Boolean(hasNextGesturesPage && !gesturesNextPageError)
        }
        availableError={gesturesQuery.isError}
        disabled={mutationsDisabled}
        busy={mutations.changeIdle.isPending}
        onAdd={(cell, gesture) => {
          const source = intentSource(gesture.source);
          if (source) void changeIdle(idleAddIntent(cell, source));
        }}
        onRemove={(member) =>
          void changeIdle({
            operation: "remove",
            binding_id: member.binding_id,
          })
        }
        onPreview={(member) => void previewIdle(member)}
        onPreviewAvailable={(gesture) => void preview("gesture", gesture)}
        onRetryAvailable={() => void gesturesQuery.refetch()}
      />
      <Dialog open={Boolean(reviewed)} onOpenChange={() => setReviewed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("loadout.review.title")}</DialogTitle>
            <DialogDescription>
              {t("loadout.review.description")}
            </DialogDescription>
          </DialogHeader>
          {reviewed ? (
            <div className="space-y-2 rounded-lg border p-4 text-sm">
              <p>
                <span className="text-muted-foreground">
                  {t("loadout.review.action")}
                </span>{" "}
                {planActionLabel(t, reviewed.plan.action)}
              </p>
              {reviewed.plan.current_name ? (
                <p>
                  <span className="text-muted-foreground">
                    {t("loadout.review.current")}
                  </span>{" "}
                  {reviewed.plan.current_name}
                </p>
              ) : null}
              {reviewed.plan.target_name ? (
                <p>
                  <span className="text-muted-foreground">
                    {t("loadout.review.result")}
                  </span>{" "}
                  {reviewed.plan.target_name}
                </p>
              ) : null}
              {(reviewed.plan.warnings ?? []).map((warning) => (
                <p key={warning.code} className="text-warning">
                  {loadoutWarningText(warning)}
                </p>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => void confirm()}
              disabled={
                committing || !reviewed || reviewed.plan.action === "unchanged"
              }
            >
              {t("loadout.review.confirm")}
            </Button>
            <Button variant="outline" onClick={() => setReviewed(null)}>
              {t("actions.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
