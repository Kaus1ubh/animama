"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  commitGestureV1AnimasAnimaIdGesturesCommitPost,
  commitAppearanceV1AnimasAnimaIdAppearanceCommitPost,
  commitIdleStyleV1AnimasAnimaIdIdleStyleCommitPost,
  commitReactionV1AnimasAnimaIdReactionsCommitPost,
  planGestureV1AnimasAnimaIdGesturesPlanPost,
  planAppearanceV1AnimasAnimaIdAppearancePlanPost,
  planIdleStyleV1AnimasAnimaIdIdleStylePlanPost,
  planReactionV1AnimasAnimaIdReactionsPlanPost,
} from "@animama/runtime-contracts/sdk";
import type {
  PyGestureCommitRequest,
  PyGesturePlanRequest,
  PyIdleStyleCommitRequest,
  PyIdleStylePlanRequest,
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
    planIdleStyle: useMutation({
      mutationFn: async (body: PyIdleStylePlanRequest) =>
        (
          await planIdleStyleV1AnimasAnimaIdIdleStylePlanPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    }),
    commitIdleStyle: useMutation({
      mutationFn: async (body: PyIdleStyleCommitRequest) =>
        (
          await commitIdleStyleV1AnimasAnimaIdIdleStyleCommitPost({
            client: apiClient,
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      onSuccess: invalidate,
    }),
  };
}
