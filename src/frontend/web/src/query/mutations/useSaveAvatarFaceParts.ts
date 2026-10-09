"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  AvatarFacePartCorrection,
  AvatarFacePartsState,
} from "@animama/runtime-contracts/api-types";
import { saveAvatarFaceParts } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { useProductApiClient } from "@animama/product-ui";

/**
 * Save (or with null, clear) an Avatar's face part correction, fenced by the
 * revision it was read at. A saved correction changes the runtime revision of
 * every Anima using the Avatar, so their runtimes are refetched.
 */
export function useSaveAvatarFaceParts(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  const client = useProductApiClient();
  const queryClient = useQueryClient();
  return useMutation<
    AvatarFacePartsState,
    Error,
    { expectedRevision: string; faceParts: AvatarFacePartCorrection | null }
  >({
    mutationFn: async ({ expectedRevision, faceParts }) => {
      if (!itemId) throw new Error("This Avatar cannot be corrected here.");
      return (
        await saveAvatarFaceParts({
          client,
          path: { item_id: itemId },
          body: { expected_revision: expectedRevision, face_parts: faceParts },
          throwOnError: true,
        })
      ).data;
    },
    onSuccess: (state) => {
      if (!userId || !itemId) return;
      queryClient.setQueryData(
        queryKeys.avatars.faceParts(userId, itemId),
        state,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.animaLoadouts.runtimes(userId),
      });
    },
  });
}
