import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  commitGestureV1AnimasAnimaIdGesturesCommitPost,
  commitAppearanceV1AnimasAnimaIdAppearanceCommitPost,
  commitIdleV1AnimasAnimaIdIdleCommitPost,
  commitReactionV1AnimasAnimaIdReactionsCommitPost,
  planGestureV1AnimasAnimaIdGesturesPlanPost,
  planAppearanceV1AnimasAnimaIdAppearancePlanPost,
  planIdleV1AnimasAnimaIdIdlePlanPost,
  planReactionV1AnimasAnimaIdReactionsPlanPost,
} from "@animama/runtime-contracts/sdk";
import type {
  PyGestureCommitRequest,
  PyGesturePlanRequest,
  PyIdlePlanRequest,
  PyLoadoutCommitResult,
  PyLoadoutDiagnostic,
  PyReactionPlanRequest,
  PyAppearanceCommitRequest,
  PyAppearancePlanRequest,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";

/**
 * Plan one pool change, then commit exactly that plan under a fresh
 * idempotency key. A rejected plan is never committed.
 */
async function planThenCommit<
  Body extends object,
  Plan extends { plan_digest: string },
  Result,
>(
  body: Body,
  plan: (body: Body) => Promise<Plan>,
  commit: (
    body: Body & { plan_digest: string; idempotency_key: string },
  ) => Promise<Result>,
): Promise<{ plan: Plan; result: Result }> {
  const planned = await plan(body);
  const result = await commit({
    ...body,
    plan_digest: planned.plan_digest,
    idempotency_key: crypto.randomUUID(),
  });
  return { plan: planned, result };
}

/** A committed Reaction change with any warnings its plan reported. */
export type ReactionChangeResult = PyLoadoutCommitResult & {
  warnings: PyLoadoutDiagnostic[];
};

export function useAnimaLoadoutMutations(animaId: string) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey() ?? "__anon__";
  const queryClient = useQueryClient();
  const invalidate = async () =>
    invalidateAnimaLoadoutAndRuntime(queryClient, userId, animaId);
  return {
    planAppearance: useMutation({
      mutationFn: async (body: PyAppearancePlanRequest) =>
        (
          await planAppearanceV1AnimasAnimaIdAppearancePlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    }),
    commitAppearance: useMutation({
      mutationFn: async (body: PyAppearanceCommitRequest) =>
        (
          await commitAppearanceV1AnimasAnimaIdAppearanceCommitPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      onSuccess: invalidate,
    }),
    planGesture: useMutation({
      mutationFn: async (body: PyGesturePlanRequest) =>
        (
          await planGestureV1AnimasAnimaIdGesturesPlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    }),
    commitGesture: useMutation({
      mutationFn: async (body: PyGestureCommitRequest) =>
        (
          await commitGestureV1AnimasAnimaIdGesturesCommitPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      onSuccess: invalidate,
    }),
    /**
     * Plan and commit one Idle pool change in one action. Idle edits skip the
     * review dialog: they never change AI-callable equipment. A failure (for
     * example a stale revision) refetches the Loadout instead of retrying.
     */
    changeIdle: useMutation({
      mutationFn: async (body: PyIdlePlanRequest) =>
        (
          await planThenCommit(
            body,
            async (planBody) =>
              (
                await planIdleV1AnimasAnimaIdIdlePlanPost({
                  client: apiClient,
                  path: { anima_id: animaId },
                  body: planBody,
                  responseValidator: undefined,
                  throwOnError: true,
                })
              ).data,
            async (commitBody) =>
              (
                await commitIdleV1AnimasAnimaIdIdleCommitPost({
                  client: apiClient,
                  path: { anima_id: animaId },
                  body: commitBody,
                  responseValidator: undefined,
                  throwOnError: true,
                })
              ).data,
          )
        ).result,
      onSettled: invalidate,
    }),
    /**
     * Plan and commit one Reaction pool change (add, remove or restore
     * starter) in one action, like Idle. The result carries the plan's
     * warnings, such as a starter Reaction that could not be restored.
     */
    changeReaction: useMutation({
      mutationFn: async (
        body: PyReactionPlanRequest,
      ): Promise<ReactionChangeResult> => {
        const { plan, result } = await planThenCommit(
          body,
          async (planBody) =>
            (
              await planReactionV1AnimasAnimaIdReactionsPlanPost({
                client: apiClient,
                path: { anima_id: animaId },
                body: planBody,
                responseValidator: undefined,
                throwOnError: true,
              })
            ).data,
          async (commitBody) =>
            (
              await commitReactionV1AnimasAnimaIdReactionsCommitPost({
                client: apiClient,
                path: { anima_id: animaId },
                body: commitBody,
                responseValidator: undefined,
                throwOnError: true,
              })
            ).data,
        );
        return { ...result, warnings: plan.warnings ?? [] };
      },
      onSettled: invalidate,
    }),
  };
}
