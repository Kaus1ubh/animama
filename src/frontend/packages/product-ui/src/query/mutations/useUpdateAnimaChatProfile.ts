import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAnimaChatProfileV1AnimasAnimaIdChatProfilePatch } from "@animama/runtime-contracts/sdk";
import type {
  PyAnimaChatProfileUpdateRequest,
  PyAnimaResponse,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "../../runtime/ProductRuntimeProvider";
import { queryKeys } from "../keys";

export type UpdateAnimaChatProfileArgs = {
  animaId: string;
  body: PyAnimaChatProfileUpdateRequest;
};

type AnimaCacheValue = PyAnimaResponse | PyAnimaResponse[] | null;

function patchAnimaChatProfile(
  current: PyAnimaResponse,
  updated: PyAnimaResponse,
): PyAnimaResponse {
  if (current.id !== updated.id) {
    return current;
  }

  return {
    ...current,
    chat_profile: updated.chat_profile ?? null,
  };
}

function patchAnimaChatProfileInCache(
  current: AnimaCacheValue,
  updated: PyAnimaResponse,
): AnimaCacheValue {
  if (Array.isArray(current)) {
    return current.map((anima) => patchAnimaChatProfile(anima, updated));
  }
  return current ? patchAnimaChatProfile(current, updated) : current;
}

export function useUpdateAnimaChatProfile() {
  const queryClient = useQueryClient();
  const client = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyAnimaResponse, Error, UpdateAnimaChatProfileArgs>({
    mutationFn: async (args) => {
      const { data } =
        await updateAnimaChatProfileV1AnimasAnimaIdChatProfilePatch({
          client,
          path: { anima_id: args.animaId },
          body: args.body,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
    onSuccess: (updated) => {
      if (!userId) return;
      queryClient.setQueriesData<AnimaCacheValue>(
        { queryKey: queryKeys.animas.all(userKey) },
        (current) => patchAnimaChatProfileInCache(current ?? null, updated),
      );
    },
  });
}
