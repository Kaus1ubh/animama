"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  commitGestureV1AnimasAnimaIdGesturesCommitPost,
  commitAppearanceV1AnimasAnimaIdAppearanceCommitPost,
  commitIdleStyleV1AnimasAnimaIdIdleStyleCommitPost,
  commitMusicTrackV1AnimasAnimaIdMusicTracksCommitPost,
  commitReactionV1AnimasAnimaIdReactionsCommitPost,
  planGestureV1AnimasAnimaIdGesturesPlanPost,
  planAppearanceV1AnimasAnimaIdAppearancePlanPost,
  planIdleStyleV1AnimasAnimaIdIdleStylePlanPost,
  planMusicTrackV1AnimasAnimaIdMusicTracksPlanPost,
  planReactionV1AnimasAnimaIdReactionsPlanPost,
} from "@animama/runtime-contracts/sdk";
import type {
  PyGestureCommitRequest,
  PyGesturePlanRequest,
  PyIdleStyleCommitRequest,
  PyIdleStylePlanRequest,
  PyMusicTrackCommitRequest,
  PyMusicTrackPlanRequest,
  PyReactionCommitRequest,
  PyReactionPlanRequest,
  PyAppearanceCommitRequest,
  PyAppearancePlanRequest,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";

export function useAnimaLoadoutMutations(animaId: string) {
  const userId = useRuntimeOwnerId() ?? "__anon__";
  const queryClient = useQueryClient();
  const invalidate = async () =>
    invalidateAnimaLoadoutAndRuntime(queryClient, userId, animaId);
  return {
    planAppearance: useMutation({
      mutationFn: async (body: PyAppearancePlanRequest) =>
        (
          await planAppearanceV1AnimasAnimaIdAppearancePlanPost({
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
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
      onSuccess: invalidate,
    }),
    planMusicTrack: useMutation({
      mutationFn: async (body: PyMusicTrackPlanRequest) =>
        (
          await planMusicTrackV1AnimasAnimaIdMusicTracksPlanPost({
            path: { anima_id: animaId },
            body,
            responseValidator: undefined,
            throwOnError: true,
          })
        ).data,
    }),
    commitMusicTrack: useMutation({
      mutationFn: async (body: PyMusicTrackCommitRequest) =>
        (
          await commitMusicTrackV1AnimasAnimaIdMusicTracksCommitPost({
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
