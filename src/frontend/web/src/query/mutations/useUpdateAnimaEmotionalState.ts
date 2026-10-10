"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAnimaEmotionalStateV1AnimasAnimaIdEmotionalStatePut } from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaResponse,
  UpdateAnimaEmotionalStateV1AnimasAnimaIdEmotionalStatePutData,
} from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

type UpdateAnimaEmotionalStateArgs = {
  animaId: string;
  body: UpdateAnimaEmotionalStateV1AnimasAnimaIdEmotionalStatePutData["body"];
};

function isAnimaResponse(value: unknown): value is PyAnimaResponse {
  return value !== null && typeof value === "object" && "id" in value;
}

function patchAnimaEmotionSnapshot(
  current: unknown,
  animaId: string,
  emotionalState: PyAnimaResponse["emotional_state"],
): unknown {
  if (Array.isArray(current)) {
    return current.map((item) => {
      if (!isAnimaResponse(item) || item.id !== animaId) {
        return item;
      }
      return {
        ...item,
        emotional_state: emotionalState,
      };
    });
  }

  if (!isAnimaResponse(current) || current.id !== animaId) {
    return current;
  }

  return {
    ...current,
    emotional_state: emotionalState,
  };
}

export function useUpdateAnimaEmotionalState() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyAnimaResponse, Error, UpdateAnimaEmotionalStateArgs>({
    mutationFn: async (args) => {
      const { data } =
        await updateAnimaEmotionalStateV1AnimasAnimaIdEmotionalStatePut({
          client: apiClient,
          path: { anima_id: args.animaId },
          body: args.body,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSuccess: (updated) => {
      if (!userId) return;
      queryClient.setQueriesData(
        {
          queryKey: queryKeys.animas.all(userKey),
        },
        (current) =>
          patchAnimaEmotionSnapshot(
            current,
            updated.id,
            updated.emotional_state ?? null,
          ),
      );
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.animas.all(userKey),
      });
    },
  });
}
