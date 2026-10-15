"use client";

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
  PyReactionCommitRequest,
  PyReactionPlanRequest,
  PyAppearanceCommitRequest,
  PyAppearancePlanRequest,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";

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
    planReaction: useMutation({
      mutationFn: async (body: PyReactionPlanRequest) =>
        (
          await planReactionV1AnimasAnimaIdReactionsPlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    }),
    commitReaction: useMutation({
      mutationFn: async (body: PyReactionCommitRequest) =>
        (
          await commitReactionV1AnimasAnimaIdReactionsCommitPost({
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
      mutationFn: async (body: PyIdlePlanRequest) => {
        const plan = (
          await planIdleV1AnimasAnimaIdIdlePlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data;
        return (
          await commitIdleV1AnimasAnimaIdIdleCommitPost({
            client: apiClient,
            path: { anima_id: animaId },
            body: {
              ...body,
              plan_digest: plan.plan_digest,
              idempotency_key: crypto.randomUUID(),
            },
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data;
      },
      onSettled: invalidate,
    }),
  };
}
