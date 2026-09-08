"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getAnimaRuntimeV1AnimasAnimaIdRuntimeGet,
  renewAnimaRuntimeV1AnimasAnimaIdRuntimeRevisionsRevisionRenewPost,
} from "@animama/runtime-contracts/sdk";
import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export function useAnimaRuntimeCatalog(animaId: string | null | undefined) {
  const userId = useRuntimeOwnerId();
  return useQuery<PyAnimaRuntime>({
    queryKey: queryKeys.animaLoadouts.runtime(
      userId ?? "__anon__",
      animaId ?? "__none__",
    ),
    enabled: Boolean(userId && animaId),
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      if (!animaId) throw new Error("An Anima is required");
      return fetchAnimaRuntimeCatalog(animaId, signal);
    },
  });
}

/** Shared typed read for normal route entry and the post-creation first mount. */
export async function fetchAnimaRuntimeCatalog(
  animaId: string,
  signal?: AbortSignal,
): Promise<PyAnimaRuntime> {
  const { data } = await getAnimaRuntimeV1AnimasAnimaIdRuntimeGet({
    path: { anima_id: animaId },
    signal,
    responseValidator: undefined,
    throwOnError: true,
  });
  return data;
}

export async function renewAnimaRuntimeCatalog(
  animaId: string,
  revision: string,
): Promise<void> {
  await renewAnimaRuntimeV1AnimasAnimaIdRuntimeRevisionsRevisionRenewPost({
    path: { anima_id: animaId, revision },
    responseValidator: undefined,
    throwOnError: true,
  });
}
